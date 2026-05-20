"""Tests for remi_worker.metrics._compute_cost and compute_metrics_delta."""

from __future__ import annotations

import pytest

from remi_worker.metrics import _compute_cost, compute_metrics_delta


_PRICING: dict[str, dict[str, float]] = {
    "gpt-4o": {"input_cost_per_1m": 2.50, "output_cost_per_1m": 10.00},
    "gpt-4o-mini": {"input_cost_per_1m": 0.15, "output_cost_per_1m": 0.60},
    "gpt-4": {"input_cost_per_1m": 30.00, "output_cost_per_1m": 60.00},
    "o1": {"input_cost_per_1m": 15.00, "output_cost_per_1m": 60.00},
    "o1-mini": {"input_cost_per_1m": 3.00, "output_cost_per_1m": 12.00},
}


class TestComputeCostExactMatch:
    def test_exact_model_name(self) -> None:
        cost, status = _compute_cost("gpt-4o", 1_000_000, 1_000_000, _PRICING)
        assert cost == pytest.approx(12.50)
        assert status == "estimated"

    def test_exact_model_name_case_insensitive(self) -> None:
        cost, _ = _compute_cost("GPT-4O", 1_000_000, 0, _PRICING)
        assert cost == pytest.approx(2.50)

    def test_zero_tokens_returns_zero_cost(self) -> None:
        cost, _ = _compute_cost("gpt-4o", 0, 0, _PRICING)
        assert cost == 0.0

    def test_no_model_returns_zero(self) -> None:
        cost, status = _compute_cost(None, 100, 100, _PRICING)
        assert cost == 0.0
        assert status == "unavailable"

    def test_empty_model_returns_zero(self) -> None:
        cost, status = _compute_cost("", 100, 100, _PRICING)
        assert cost == 0.0
        assert status == "unavailable"

    def test_unknown_model_returns_zero(self) -> None:
        cost, status = _compute_cost("unknown-model-xyz", 100, 100, _PRICING)
        assert cost == 0.0
        assert status == "unavailable"


class TestComputeCostPrefixFallback:
    """Verify that versioned aliases resolve via prefix match."""

    def test_gpt4o_versioned_resolves_to_gpt4o(self) -> None:
        # gpt-4o-2024-08-06 should match gpt-4o (not gpt-4)
        cost, _ = _compute_cost("gpt-4o-2024-08-06", 1_000_000, 0, _PRICING)
        expected, _ = _compute_cost("gpt-4o", 1_000_000, 0, _PRICING)
        assert cost == pytest.approx(expected)

    def test_gpt4o_mini_versioned_resolves_to_gpt4o_mini(self) -> None:
        # gpt-4o-mini-2024-07-18 should match gpt-4o-mini (not gpt-4o or gpt-4)
        cost, _ = _compute_cost("gpt-4o-mini-2024-07-18", 0, 1_000_000, _PRICING)
        expected, _ = _compute_cost("gpt-4o-mini", 0, 1_000_000, _PRICING)
        assert cost == pytest.approx(expected)

    def test_o1_mini_versioned_resolves_to_o1_mini(self) -> None:
        # o1-mini-2024-09-12 should match o1-mini (not o1)
        cost, _ = _compute_cost("o1-mini-2024-09-12", 1_000_000, 0, _PRICING)
        expected, _ = _compute_cost("o1-mini", 1_000_000, 0, _PRICING)
        assert cost == pytest.approx(expected)

    def test_o1_versioned_does_not_match_o1_mini(self) -> None:
        # o1-preview should match o1 (o1-mini is NOT a prefix of o1-preview)
        cost, _ = _compute_cost("o1-preview", 1_000_000, 0, _PRICING)
        expected, _ = _compute_cost("o1", 1_000_000, 0, _PRICING)
        assert cost == pytest.approx(expected)

    def test_prefix_fallback_case_insensitive(self) -> None:
        cost, _ = _compute_cost("GPT-4O-2024-08-06", 1_000_000, 0, _PRICING)
        expected, _ = _compute_cost("gpt-4o", 1_000_000, 0, _PRICING)
        assert cost == pytest.approx(expected)

    def test_empty_pricing_table_returns_zero(self) -> None:
        cost, status = _compute_cost("gpt-4o-2024-08-06", 100, 100, {})
        assert cost == 0.0
        assert status == "unavailable"


def _llm_span(
    session_id: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    *,
    finish_reasons: list[str] | None = None,
    status_code: int = 0,
    duration_ms: int = 100,
    org_id: str | None = None,
    agent_id: str | None = None,
) -> dict:
    """Helper: build a minimal otel_span event with span_category='llm'."""
    event: dict = {
        "session_id": session_id,
        "event_type": "otel_span",
        "data": {
            "span_category": "llm",
            "model": model,
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
            "finish_reasons": finish_reasons or [],
            "status_code": status_code,
            "duration_ms": duration_ms,
        },
    }
    if org_id is not None:
        event["org_id"] = org_id
    if agent_id is not None:
        event["agent_id"] = agent_id
    return event


def _tool_span(
    session_id: str,
    tool_name: str,
    *,
    status_code: int = 0,
    duration_ms: int = 50,
) -> dict:
    """Helper: build a minimal otel_span event with span_category='tool'."""
    return {
        "session_id": session_id,
        "event_type": "otel_span",
        "data": {
            "span_category": "tool",
            "tool_name": tool_name,
            "status_code": status_code,
            "duration_ms": duration_ms,
        },
    }


def _root_span(session_id: str, *, has_parent: bool = False) -> dict:
    """Helper: build a minimal otel_span event with span_category='root'."""
    data: dict = {"span_category": "root"}
    if has_parent:
        data["parent_span_id"] = "deadbeef"
    return {"session_id": session_id, "event_type": "otel_span", "data": data}


def _chain_span(session_id: str, *, has_parent: bool = False) -> dict:
    """Helper: build a minimal otel_span event with span_category='chain'."""
    data: dict = {"span_category": "chain"}
    if has_parent:
        data["parent_span_id"] = "deadbeef"
    return {"session_id": session_id, "event_type": "otel_span", "data": data}


class TestComputeMetricsDelta:
    def test_org_id_and_agent_id_carried_per_session(self) -> None:
        events = [
            _tool_span("s-org", "search"),
            _llm_span("s-org", "gpt-4o", 100, 50, org_id="org-123", agent_id="agent-abc"),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert result["s-org"]["org_id"] == "org-123"
        assert result["s-org"]["agent_id"] == "agent-abc"
        assert result["s-org"]["tool_calls"] == 1
        assert result["s-org"]["llm_calls"] == 1

    def test_cost_accumulates_across_llm_spans(self) -> None:
        events = [
            _llm_span("s1", "gpt-4o-2024-08-06", 1_000_000, 0),
            _llm_span("s1", "gpt-4o-mini", 0, 1_000_000),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert "s1" in result
        expected = 2.50 + 0.60  # gpt-4o input + gpt-4o-mini output
        assert result["s1"]["estimated_cost_usd"] == pytest.approx(expected)

    def test_no_pricing_table_produces_zero_cost(self) -> None:
        events = [_llm_span("s2", "gpt-4o", 1_000_000, 1_000_000)]
        result = compute_metrics_delta(events, pricing={})
        assert result["s2"]["estimated_cost_usd"] == 0.0

    def test_token_counters_sum_correctly(self) -> None:
        events = [
            _llm_span("s3", "gpt-4o", 500, 200),
            _llm_span("s3", "gpt-4o", 300, 100),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert result["s3"]["prompt_tokens"] == 800
        assert result["s3"]["completion_tokens"] == 300
        assert result["s3"]["total_tokens"] == 1100
        assert result["s3"]["llm_calls"] == 2

    def test_tool_calls_and_errors_counted(self) -> None:
        events = [
            _tool_span("s4", "search", duration_ms=80),
            _tool_span("s4", "search", status_code=2, duration_ms=20),
            _tool_span("s4", "calculator", duration_ms=10),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert result["s4"]["tool_calls"] == 3
        assert result["s4"]["error_count"] == 1
        assert result["s4"]["has_error"] is True
        assert result["s4"]["tool_usage"]["search"]["calls"] == 2
        assert result["s4"]["tool_usage"]["search"]["errors"] == 1
        assert result["s4"]["tool_usage"]["calculator"]["calls"] == 1

    def test_session_marked_complete_on_root_span_without_parent(self) -> None:
        events = [
            _llm_span("s5", "gpt-4o", 100, 50),
            _root_span("s5", has_parent=False),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert result["s5"]["is_complete"] is True

    def test_session_not_complete_when_root_span_has_parent(self) -> None:
        events = [
            _root_span("s6", has_parent=True),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert result["s6"]["is_complete"] is False

    def test_chain_span_without_parent_does_not_mark_session_complete(self) -> None:
        events = [
            _chain_span("s6b", has_parent=False),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert result["s6b"]["is_complete"] is False

    def test_finish_reasons_aggregated(self) -> None:
        events = [
            _llm_span("s7", "gpt-4o", 100, 50, finish_reasons=["stop"]),
            _llm_span("s7", "gpt-4o", 100, 50, finish_reasons=["stop"]),
            _llm_span("s7", "gpt-4o", 100, 50, finish_reasons=["length"]),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert result["s7"]["finish_reasons"] == {"stop": 2, "length": 1}

    def test_model_usage_breakdown(self) -> None:
        events = [
            _llm_span("s8", "gpt-4o", 400, 100),
            _llm_span("s8", "gpt-4o-mini", 200, 50),
            _llm_span("s8", "gpt-4o", 600, 200),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert result["s8"]["model_usage"]["gpt-4o"]["calls"] == 2
        assert result["s8"]["model_usage"]["gpt-4o"]["tokens"] == 1300
        assert result["s8"]["model_usage"]["gpt-4o-mini"]["calls"] == 1

    def test_non_otel_span_events_counted_but_not_aggregated(self) -> None:
        """Legacy or unknown event types increment total_events but no metrics."""
        events = [
            {"session_id": "s9", "event_type": "unknown_type", "data": {}},
            _llm_span("s9", "gpt-4o", 100, 50),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert result["s9"]["total_events"] == 2
        assert result["s9"]["llm_calls"] == 1
        assert result["s9"]["event_type_counts"]["unknown_type"] == 1
        assert result["s9"]["event_type_counts"]["otel_span"] == 1

    def test_span_category_counts_not_exposed(self) -> None:
        events = [
            _llm_span("s10", "gpt-4o", 100, 50),
            _tool_span("s10", "search"),
            _tool_span("s10", "fetch"),
            _root_span("s10"),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert "span_category_counts" not in result["s10"]

    def test_multiple_sessions_isolated(self) -> None:
        events = [
            _llm_span("sess-a", "gpt-4o", 1_000, 500),
            _llm_span("sess-b", "gpt-4o-mini", 2_000, 1_000),
        ]
        result = compute_metrics_delta(events, pricing=_PRICING)
        assert set(result.keys()) == {"sess-a", "sess-b"}
        assert result["sess-a"]["llm_calls"] == 1
        assert result["sess-b"]["llm_calls"] == 1
        assert result["sess-a"]["prompt_tokens"] == 1_000
        assert result["sess-b"]["prompt_tokens"] == 2_000
