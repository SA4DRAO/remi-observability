"""Incremental metric aggregation from a batch of OTEL span events.

``compute_metrics_delta`` groups a batch by session_id and extracts
counters / breakdowns that can be upserted into the ``session_metrics``
table with purely additive arithmetic (no read-modify-write cycle).

All incoming events must have ``event_type == "otel_span"`` with a
``data.span_category`` field (llm | tool | chain | root | unknown) set
by the backend normalizer (otlp.service.ts).

Cost calculation uses per-model pricing loaded from the ``model_pricing``
table (split input/output rates per 1M tokens).  When a model is unknown
the cost for that call is zero — no silent mis-pricing.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Type alias for the pricing lookup returned by DatabasePool.load_model_pricing()
# Values may include None for dimension costs that are not priced separately.
PricingTable = Dict[str, Dict[str, Optional[float]]]

#: Fallback pricing used *only* when no pricing table is supplied (e.g. in
#: unit tests).  Production code should always pass a real table.
_FALLBACK_PRICING: PricingTable = {}

# OTLP status code for errors (value 2 per OTel spec).
_STATUS_ERROR = 2


def _normalize_org_id(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def _normalize_agent_id(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def _compute_cost(
    model: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    pricing: PricingTable,
    *,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    reasoning_tokens: int = 0,
) -> Tuple[float, str]:
    """Compute USD cost and a cost_status for a single LLM span.

    Returns a ``(cost_usd, cost_status)`` tuple where ``cost_status`` is:
    - ``'unavailable'`` – model not found in the pricing table
    - ``'partial'``     – model found, but some billable dimensions have no rate
    - ``'estimated'``   – all applicable dimensions were priced
    """
    if not model:
        return (0.0, "unavailable")

    # 1. Exact match, then case-folded
    model_lower = model.lower()
    rates = pricing.get(model) if model in pricing else pricing.get(model_lower)

    # 2. Longest-prefix fallback for date-stamped aliases (e.g. gpt-4o-2024-08-06)
    if rates is None:
        matched_key = max(
            (k for k in pricing if model_lower.startswith(k.lower())),
            key=len,
            default=None,
        )
        if matched_key is not None:
            rates = pricing[matched_key]
            logger.debug(
                "Pricing prefix match: model=%r matched_key=%r",
                model,
                matched_key,
            )

    if rates is None:
        logger.debug("No pricing entry for model %r — cost will be 0", model)
        return (0.0, "unavailable")

    input_cost = (prompt_tokens / 1_000_000) * rates["input_cost_per_1m"]
    output_cost = (completion_tokens / 1_000_000) * rates["output_cost_per_1m"]
    cost = input_cost + output_cost
    status = "estimated"

    if reasoning_tokens > 0:
        rate = rates.get("reasoning_cost_per_1m")
        if rate is not None:
            cost += (reasoning_tokens / 1_000_000) * rate
        else:
            status = "partial"

    if cache_write_tokens > 0:
        rate = rates.get("cache_input_cost_per_1m")
        if rate is not None:
            cost += (cache_write_tokens / 1_000_000) * rate
        else:
            status = "partial"

    if cache_read_tokens > 0:
        rate = rates.get("cache_read_cost_per_1m")
        if rate is not None:
            cost -= (cache_read_tokens / 1_000_000) * rates["input_cost_per_1m"]
            cost += (cache_read_tokens / 1_000_000) * rate
        else:
            status = "partial"

    return (round(max(cost, 0.0), 8), status)


def compute_metrics_delta(
    events: List[Dict[str, Any]],
    pricing: Optional[PricingTable] = None,
) -> Dict[str, Dict[str, Any]]:
    """Return per-session incremental metric deltas for the given OTEL span batch.

    Expects events with ``event_type == "otel_span"`` and a ``data`` dict
    containing the fields emitted by the backend's ``normalizeOtlpPayload``:

    All spans:
        - ``span_category``: 'llm' | 'tool' | 'chain' | 'root' | 'unknown'
        - ``span_id``, ``trace_id``, ``span_name``
        - ``duration_ms`` (float, optional)
        - ``status_code`` (int, optional; 2 = error per OTel spec)
        - ``start_time_ns`` / ``end_time_ns`` (string nanoseconds, optional)

    LLM spans (``span_category == 'llm'``):
        - ``usage``: {prompt_tokens, completion_tokens, total_tokens}
        - ``model``: model name string
        - ``finish_reasons``: list of strings

    Tool spans (``span_category == 'tool'``):
        - ``tool_name``: string

    The returned structure is::

        {
            "<session_id>": {
                "org_id": str | None,
                "agent_id": str | None,
                "total_events": int,
                "llm_calls": int,
                "tool_calls": int,
                "error_count": int,
                "prompt_tokens": int,
                "completion_tokens": int,
                "total_tokens": int,
                "estimated_cost_usd": float,
                "cost_status": 'estimated' | 'partial' | 'unavailable',
                "total_llm_duration_ms": int,
                "total_tool_duration_ms": int,
                "max_agent_iteration": int,
                "finish_reasons": {reason: count, ...},
                "tool_usage": {tool: {calls, errors, total_ms}, ...},
                "model_usage": {model: {calls, tokens}, ...},
                "event_type_counts": {event_type: count, ...},
                "first_event_at": datetime | None,
                "last_event_at": datetime | None,
                "is_complete": bool,
                "has_error": bool,
            },
            ...
        }
    """
    effective_pricing = pricing if pricing is not None else _FALLBACK_PRICING
    by_session: Dict[str, Dict[str, Any]] = {}

    for event in events:
        sid: str = event.get("session_id") or "unknown"
        etype: str = event.get("event_type") or "unknown"
        data: Dict[str, Any] = event.get("data") or {}

        if sid not in by_session:
            by_session[sid] = _empty_delta()

        m = by_session[sid]

        # ── org_id / agent_id from event envelope ──────────────────────────
        org_id = _normalize_org_id(event.get("org_id"))
        if org_id is not None:
            if m["org_id"] is None:
                m["org_id"] = org_id
            elif m["org_id"] != org_id:
                logger.warning(
                    "Conflicting org_id in batch for session=%s existing=%s new=%s",
                    sid, m["org_id"], org_id,
                )

        agent_id = _normalize_agent_id(event.get("agent_id"))
        if agent_id is not None:
            if m["agent_id"] is None:
                m["agent_id"] = agent_id
            elif m["agent_id"] != agent_id:
                logger.warning(
                    "Conflicting agent_id in batch for session=%s existing=%s new=%s",
                    sid, m["agent_id"], agent_id,
                )

        m["total_events"] += 1
        m["event_type_counts"][etype] = m["event_type_counts"].get(etype, 0) + 1

        # Only process structured span data from OTEL events
        if etype != "otel_span":
            continue

        category: str = data.get("span_category") or "unknown"

        # ── Timestamp range — use start_time_ns when available ─────────────
        start_ns: Optional[str] = data.get("start_time_ns")
        if start_ns:
            try:
                ms = int(int(start_ns) // 1_000_000)
                ts = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
                if m["first_event_at"] is None or ts < m["first_event_at"]:
                    m["first_event_at"] = ts
                if m["last_event_at"] is None or ts > m["last_event_at"]:
                    m["last_event_at"] = ts
            except (ValueError, TypeError, OverflowError):
                pass

        # ── Error detection via OTLP status_code == 2 ──────────────────────
        status_code = data.get("status_code")
        if status_code == _STATUS_ERROR:
            m["error_count"] += 1
            m["has_error"] = True

        duration_ms = int(data.get("duration_ms") or 0)

        # ── LLM spans ──────────────────────────────────────────────────────
        if category == "llm":
            m["llm_calls"] += 1
            m["total_llm_duration_ms"] += duration_ms

            usage: Any = data.get("usage") or {}
            prompt_tok = 0
            completion_tok = 0
            total_tok = 0
            if isinstance(usage, dict):
                prompt_tok = int(usage.get("prompt_tokens") or 0)
                completion_tok = int(usage.get("completion_tokens") or 0)
                total_tok = int(usage.get("total_tokens") or 0)
                if total_tok == 0 and (prompt_tok + completion_tok) > 0:
                    total_tok = prompt_tok + completion_tok

            if prompt_tok == 0 and completion_tok == 0:
                logger.debug(
                    "otel_span llm zero token usage: session=%s model=%s",
                    sid, data.get("model"),
                )

            m["prompt_tokens"] += prompt_tok
            m["completion_tokens"] += completion_tok
            m["total_tokens"] += total_tok

            # Finish reasons (list from gen_ai.response.finish_reasons)
            finish_reasons: Any = data.get("finish_reasons") or []
            if isinstance(finish_reasons, list):
                for fr in finish_reasons:
                    if fr:
                        m["finish_reasons"][fr] = m["finish_reasons"].get(fr, 0) + 1
            elif isinstance(finish_reasons, str) and finish_reasons:
                m["finish_reasons"][finish_reasons] = (
                    m["finish_reasons"].get(finish_reasons, 0) + 1
                )

            # Model usage
            model: Optional[str] = data.get("model")
            if model:
                mu = m["model_usage"].setdefault(model, {"calls": 0, "tokens": 0})
                mu["calls"] += 1
                mu["tokens"] += total_tok

            # Cost
            call_cost, call_status = _compute_cost(
                model, prompt_tok, completion_tok, effective_pricing
            )
            m["estimated_cost_usd"] += call_cost

            existing_status = m["cost_status"]
            if call_status == "unavailable" or existing_status == "unavailable":
                m["cost_status"] = "unavailable"
            elif call_status == "partial" or existing_status == "partial":
                m["cost_status"] = "partial"

        # ── Tool spans ─────────────────────────────────────────────────────
        elif category == "tool":
            m["tool_calls"] += 1
            m["total_tool_duration_ms"] += duration_ms
            tool_name: str = data.get("tool_name") or data.get("span_name") or "unknown"
            tu = m["tool_usage"].setdefault(tool_name, {"calls": 0, "errors": 0, "total_ms": 0})
            tu["calls"] += 1
            tu["total_ms"] += duration_ms
            if status_code == _STATUS_ERROR:
                tu["errors"] += 1

        # ── Root session spans close the OTEL session when they end ────────
        elif category == "root":
            if not data.get("parent_span_id"):
                m["is_complete"] = True

    return by_session


def _empty_delta() -> Dict[str, Any]:
    return {
        "org_id": None,
        "agent_id": None,
        "total_events": 0,
        "llm_calls": 0,
        "tool_calls": 0,
        "error_count": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "estimated_cost_usd": 0.0,
        "cost_status": "estimated",
        "total_llm_duration_ms": 0,
        "total_tool_duration_ms": 0,
        "max_agent_iteration": 0,
        "finish_reasons": {},
        "tool_usage": {},
        "model_usage": {},
        "event_type_counts": {},
        "first_event_at": None,
        "last_event_at": None,
        "is_complete": False,
        "has_error": False,
    }

import logging
