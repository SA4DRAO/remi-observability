"""PostgreSQL connection pool and query helpers for remi-worker."""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

import asyncpg # type: ignore

from .config import Config

logger = logging.getLogger(__name__)


class DatabasePool:
    """Async PostgreSQL connection pool.

    Lifecycle::

        pool = DatabasePool(cfg)
        await pool.initialize()
        ...
        await pool.close()
    """

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self.pool: Optional[asyncpg.Pool] = None

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def initialize(self) -> None:
        """Create the underlying asyncpg connection pool."""
        self.pool = await asyncpg.create_pool(
            host=self._cfg.db_host,
            port=self._cfg.db_port,
            user=self._cfg.db_user,
            password=self._cfg.db_password,
            database=self._cfg.db_name,
            min_size=self._cfg.db_pool_min,
            max_size=self._cfg.db_pool_max,
            timeout=self._cfg.db_pool_acquire_timeout,
            command_timeout=self._cfg.db_statement_timeout_ms / 1000.0,
        )
        logger.info(
            "Database pool initialized (host=%s db=%s pool=%d-%d acquire_timeout=%ds cmd_timeout=%ds)",
            self._cfg.db_host,
            self._cfg.db_name,
            self._cfg.db_pool_min,
            self._cfg.db_pool_max,
            self._cfg.db_pool_acquire_timeout,
            int(self._cfg.db_statement_timeout_ms / 1000),
        )

    async def close(self) -> None:
        """Gracefully close all connections in the pool."""
        if self.pool:
            await self.pool.close()
            logger.info("Database pool closed")

    # ── Model pricing ─────────────────────────────────────────────────────

    async def load_model_pricing(self) -> Dict[str, Dict[str, float]]:
        """Load all rows from ``model_pricing`` into a lookup dict.

        Returns::

            {
                "gpt-4o": {
                    "input_cost_per_1m": 2.5,
                    "output_cost_per_1m": 10.0,
                    # nullable dimension costs (None when not priced separately)
                    "cache_input_cost_per_1m": None,
                    "cache_read_cost_per_1m": None,
                    "reasoning_cost_per_1m": None,
                },
                ...
            }
        """
        assert self.pool is not None, "Pool not initialised"
        started = time.perf_counter()
        try:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT model_name,
                           input_cost_per_1m,
                           output_cost_per_1m,
                           cache_input_cost_per_1m,
                           cache_read_cost_per_1m,
                           reasoning_cost_per_1m
                    FROM model_pricing
                    """
                )
        except asyncpg.exceptions.QueryCanceledError:
            logger.error("Query canceled (timeout) loading model pricing")
            raise
        pricing = {
            r["model_name"]: {
                "input_cost_per_1m":         float(r["input_cost_per_1m"]),
                "output_cost_per_1m":        float(r["output_cost_per_1m"]),
                "cache_input_cost_per_1m":   float(r["cache_input_cost_per_1m"]) if r["cache_input_cost_per_1m"] is not None else None,
                "cache_read_cost_per_1m":    float(r["cache_read_cost_per_1m"])  if r["cache_read_cost_per_1m"]  is not None else None,
                "reasoning_cost_per_1m":     float(r["reasoning_cost_per_1m"])   if r["reasoning_cost_per_1m"]   is not None else None,
            }
            for r in rows
        }
        logger.info(
            "Loaded pricing for %d models (%.2f ms)",
            len(pricing),
            (time.perf_counter() - started) * 1000,
        )
        return pricing

    # ── Sessions ──────────────────────────────────────────────────────────

    async def store_session(
        self,
        session_id: str,
        name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        org_id: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> None:
        """Upsert a session row (idempotent)."""
        assert self.pool is not None, "Pool not initialised"
        started = time.perf_counter()
        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO sessions (session_id, name, metadata, org_id, agent_id)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (session_id) DO UPDATE
                    SET metadata  = $3,
                        org_id    = COALESCE(EXCLUDED.org_id,   sessions.org_id),
                        agent_id  = COALESCE(EXCLUDED.agent_id, sessions.agent_id),
                        updated_at = NOW()
                    """,
                    session_id,
                    name,
                    json.dumps(metadata or {}),
                    org_id,
                    agent_id,
                )
        except asyncpg.exceptions.QueryCanceledError:
            logger.error(
                "Query canceled (timeout) storing session: session_id=%s", session_id
            )
            raise
        logger.debug(
            "Session upserted: session_id=%s has_name=%s metadata_keys=%s (%.2f ms)",
            session_id,
            bool(name),
            list((metadata or {}).keys())[:10],
            (time.perf_counter() - started) * 1000,
        )

    async def store_sessions_batch(self, sessions: List[Dict[str, Any]]) -> None:
        """Upsert session stubs from event batches without clearing richer session data."""
        if not sessions:
            return

        assert self.pool is not None, "Pool not initialised"
        started = time.perf_counter()
        try:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO sessions (session_id, org_id, agent_id)
                    SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])
                        AS t(session_id, org_id, agent_id)
                    ON CONFLICT (session_id) DO UPDATE
                    SET org_id    = COALESCE(EXCLUDED.org_id,   sessions.org_id),
                        agent_id  = COALESCE(EXCLUDED.agent_id, sessions.agent_id),
                        updated_at = NOW()
                    """,
                    [session["session_id"] for session in sessions],
                    [session.get("org_id") for session in sessions],
                    [session.get("agent_id") for session in sessions],
                )
        except asyncpg.exceptions.QueryCanceledError:
            logger.error(
                "Query canceled (timeout) storing %d session stub(s)",
                len(sessions),
            )
            raise
        logger.debug(
            "Session stubs upserted: count=%d session_ids=%s (%.2f ms)",
            len(sessions),
            [session["session_id"] for session in sessions[:5]],
            (time.perf_counter() - started) * 1000,
        )

    # ── Events ────────────────────────────────────────────────────────────

    async def store_events_batch(self, events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Bulk-insert events using UNNEST for a single round-trip.

        Events with a ``_seq`` number are inserted idempotently: duplicate
        ``(session_id, seq)`` pairs are silently ignored (``ON CONFLICT DO NOTHING``).
        This prevents double-counting metrics when the worker replays messages
        after a crash.

        Returns only the rows that were actually inserted (not skipped
        duplicates), as a list of dicts with ``id``, ``session_id``, and
        ``seq`` so the caller can build an exact filtered batch for metrics.
        """
        if not events:
            logger.warning("store_events_batch called with empty list – skipping")
            return []

        assert self.pool is not None, "Pool not initialised"
        started = time.perf_counter()
        logger.info(
            "Inserting %d events (first types: %s)",
            len(events),
            [e.get("event_type") for e in events[:5]],
        )

        try:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    INSERT INTO events (session_id, event_type, event_data, seq, org_id, agent_id, run_id, parent_run_id)
                    SELECT * FROM UNNEST($1::text[], $2::text[], $3::jsonb[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[])
                        AS t(session_id, event_type, event_data, seq, org_id, agent_id, run_id, parent_run_id)
                    ON CONFLICT (session_id, seq) WHERE seq IS NOT NULL DO NOTHING
                    RETURNING id, session_id, seq
                    """,
                    [e["session_id"] for e in events],
                    [e["event_type"] for e in events],
                    [json.dumps(e.get("data", {})) for e in events],
                    [e.get("_seq") for e in events],
                    [e.get("org_id") for e in events],
                    [e.get("agent_id") for e in events],
                    [
                        e.get("run_id") or (e.get("data") or {}).get("run_id") or None
                        for e in events
                    ],
                    [
                        e.get("parent_run_id") or (e.get("data") or {}).get("parent_run_id") or None
                        for e in events
                    ],
                )
        except asyncpg.exceptions.QueryCanceledError:
            logger.error(
                "Query canceled (timeout) inserting %d events", len(events)
            )
            raise

        inserted = [{"id": r["id"], "session_id": r["session_id"], "seq": r["seq"]} for r in rows]
        skipped = len(events) - len(inserted)
        if skipped:
            logger.info(
                "Idempotency: skipped %d duplicate event(s), inserted %d (%.2f ms)",
                skipped,
                len(inserted),
                (time.perf_counter() - started) * 1000,
            )
        else:
            logger.info(
                "Inserted %d events, first IDs: %s… (%.2f ms)",
                len(inserted),
                [r["id"] for r in inserted[:5]],
                (time.perf_counter() - started) * 1000,
            )
        return inserted

    # ── Session metrics ───────────────────────────────────────────────────

    async def update_session_metrics(
        self, metrics_by_session: Dict[str, Dict[str, Any]]
    ) -> None:
        """Upsert incremental metric deltas into ``session_metrics``.

        Uses Postgres ``jsonb_add_counts()`` to merge JSONB breakdowns and
        arithmetic operators to accumulate scalars without a
        read-modify-write cycle.

        NULL-safe timestamp logic:
        - ``first_event_at``: keep the *smaller* non-NULL value.
        - ``last_event_at``:  keep the *larger*  non-NULL value.
        Using ``LEAST``/``GREATEST`` alone would return NULL when either
        operand is NULL (Postgres standard behaviour), so we use CASE
        expressions to guard against batches that carry no timestamps.
        """
        if not metrics_by_session:
            return

        assert self.pool is not None, "Pool not initialised"

        started = time.perf_counter()
        applied = 0
        async with self.pool.acquire() as conn:
            for session_id, m in metrics_by_session.items():
                try:
                    await conn.execute(
                        """
                        INSERT INTO session_metrics (
                            session_id,
                            org_id,
                            agent_id,
                            total_events, llm_calls, tool_calls, error_count,
                            prompt_tokens, completion_tokens, total_tokens,
                            estimated_cost_usd,
                            cost_status,
                            total_llm_duration_ms, total_tool_duration_ms,
                            max_agent_iteration,
                            finish_reasons, tool_usage, model_usage, event_type_counts,
                            first_event_at, last_event_at,
                            is_complete, has_error
                        ) VALUES (
                            $1,
                            $2,
                            $3,
                            $4, $5, $6, $7,
                            $8, $9, $10,
                            $11,
                            $12,
                            $13, $14,
                            $15,
                            $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb,
                            $20, $21,
                            $22, $23
                        )
                        ON CONFLICT (session_id) DO UPDATE SET
                            org_id                 = COALESCE(EXCLUDED.org_id,   session_metrics.org_id),
                            agent_id               = COALESCE(EXCLUDED.agent_id, session_metrics.agent_id),
                            total_events           = session_metrics.total_events           + EXCLUDED.total_events,
                            llm_calls              = session_metrics.llm_calls              + EXCLUDED.llm_calls,
                            tool_calls             = session_metrics.tool_calls             + EXCLUDED.tool_calls,
                            error_count            = session_metrics.error_count            + EXCLUDED.error_count,
                            prompt_tokens          = session_metrics.prompt_tokens          + EXCLUDED.prompt_tokens,
                            completion_tokens      = session_metrics.completion_tokens      + EXCLUDED.completion_tokens,
                            total_tokens           = session_metrics.total_tokens           + EXCLUDED.total_tokens,
                            estimated_cost_usd     = session_metrics.estimated_cost_usd     + EXCLUDED.estimated_cost_usd,
                            cost_status            = CASE
                                WHEN EXCLUDED.cost_status = 'unavailable'
                                    THEN 'unavailable'
                                WHEN session_metrics.cost_status = 'unavailable'
                                    THEN 'unavailable'
                                WHEN EXCLUDED.cost_status = 'partial'
                                    THEN 'partial'
                                WHEN session_metrics.cost_status = 'partial'
                                    THEN 'partial'
                                ELSE 'estimated'
                            END,
                            total_llm_duration_ms  = session_metrics.total_llm_duration_ms  + EXCLUDED.total_llm_duration_ms,
                            total_tool_duration_ms = session_metrics.total_tool_duration_ms + EXCLUDED.total_tool_duration_ms,
                            max_agent_iteration    = GREATEST(session_metrics.max_agent_iteration, EXCLUDED.max_agent_iteration),
                            finish_reasons         = jsonb_add_counts(session_metrics.finish_reasons,   EXCLUDED.finish_reasons),
                            tool_usage             = jsonb_add_counts(session_metrics.tool_usage,        EXCLUDED.tool_usage),
                            model_usage            = jsonb_add_counts(session_metrics.model_usage,       EXCLUDED.model_usage),
                            event_type_counts      = jsonb_add_counts(session_metrics.event_type_counts, EXCLUDED.event_type_counts),
                            first_event_at = CASE
                                WHEN EXCLUDED.first_event_at IS NULL THEN session_metrics.first_event_at
                                WHEN session_metrics.first_event_at IS NULL THEN EXCLUDED.first_event_at
                                ELSE LEAST(session_metrics.first_event_at, EXCLUDED.first_event_at)
                            END,
                            last_event_at = CASE
                                WHEN EXCLUDED.last_event_at IS NULL THEN session_metrics.last_event_at
                                WHEN session_metrics.last_event_at IS NULL THEN EXCLUDED.last_event_at
                                ELSE GREATEST(session_metrics.last_event_at, EXCLUDED.last_event_at)
                            END,
                            is_complete            = session_metrics.is_complete OR EXCLUDED.is_complete,
                            has_error              = session_metrics.has_error   OR EXCLUDED.has_error,
                            updated_at             = NOW()
                        """,
                        session_id,
                        m["org_id"],
                        m["agent_id"],
                        m["total_events"], m["llm_calls"], m["tool_calls"], m["error_count"],
                        m["prompt_tokens"], m["completion_tokens"], m["total_tokens"],
                        float(m["estimated_cost_usd"]),
                        m["cost_status"],
                        m["total_llm_duration_ms"], m["total_tool_duration_ms"],
                        m["max_agent_iteration"],
                        json.dumps(m["finish_reasons"]),
                        json.dumps(m["tool_usage"]),
                        json.dumps(m["model_usage"]),
                        json.dumps(m["event_type_counts"]),
                        m["first_event_at"],
                        m["last_event_at"],
                        m["is_complete"],
                        m["has_error"],
                    )
                    applied += 1
                except asyncpg.exceptions.QueryCanceledError:
                    logger.error(
                        "Query canceled (timeout) updating session metrics: session_id=%s",
                        session_id,
                    )
                    # Continue with other sessions instead of failing entire batch
                except Exception as exc:
                    logger.error(
                        "update_session_metrics failed for session %s: %s",
                        session_id,
                        exc,
                        exc_info=True,
                    )
        logger.info(
            "Session metrics upsert complete: sessions=%d applied=%d skipped=%d (%.2f ms)",
            len(metrics_by_session),
            applied,
            len(metrics_by_session) - applied,
            (time.perf_counter() - started) * 1000,
        )

    # ── V2 write path ─────────────────────────────────────────────────────

    async def store_spans_v2_from_events(self, events: List[Dict[str, Any]]) -> int:
        """Write SDK batch events to spans_v2 and related V2 tables.

        Maps legacy SDK event fields to spans_v2 columns. Also upserts
        session_v2, traces_v2, and usage_facts_v2 rows, then calls
        update_session_rollup_v2 for each affected session.
        Returns count of span rows inserted.
        """
        if not events:
            return 0

        assert self.pool is not None, "Pool not initialised"

        span_rows: List[tuple] = []
        session_rows: List[tuple] = []
        trace_rows: List[tuple] = []
        usage_rows: List[tuple] = []

        seen_sessions: Dict[str, tuple] = {}
        seen_traces: Dict[str, tuple] = {}

        for event in events:
            raw_id = event.get("event_id") or event.get("_seq")
            span_id = str(raw_id) if raw_id is not None else str(uuid.uuid4())
            session_id = event.get("session_id", "")
            org_id = event.get("org_id", "") or ""
            agent_id = event.get("agent_id", "") or ""
            trace_id = session_id
            name = event.get("event_type", "unknown")
            kind = 0

            data = event.get("data") or {}
            status_code = 2 if data.get("error") else 0

            ts = event.get("timestamp")
            if ts is not None:
                start_time_ns = int(float(ts) * 1e9)
                end_time_ns = start_time_ns
            else:
                start_time_ns = 0
                end_time_ns = 0

            span_rows.append((
                span_id, trace_id, session_id, org_id, agent_id,
                name, kind, status_code, start_time_ns, end_time_ns, "sdk",
            ))

            if session_id and session_id not in seen_sessions:
                seen_sessions[session_id] = (session_id, org_id, agent_id)

            if trace_id and trace_id not in seen_traces:
                seen_traces[trace_id] = (trace_id, session_id, org_id, agent_id)

            event_type_lower = name.lower()
            if "llm" in event_type_lower or "chat" in event_type_lower:
                usage = data.get("usage") or {}
                prompt_tokens = usage.get("prompt_tokens") or 0
                completion_tokens = usage.get("completion_tokens") or 0
                total_tokens = usage.get("total_tokens") or 0
                if prompt_tokens or completion_tokens or total_tokens:
                    model_name = data.get("model") or ""
                    usage_rows.append((
                        span_id, trace_id, session_id, org_id, agent_id,
                        model_name,
                        int(prompt_tokens),
                        int(completion_tokens),
                        int(total_tokens),
                    ))

        session_rows = list(seen_sessions.values())
        trace_rows = list(seen_traces.values())

        async with self.pool.acquire() as conn:
            inserted_count = 0
            if span_rows:
                result = await conn.executemany(
                    """
                    INSERT INTO spans_v2 (
                        span_id, trace_id, session_id, org_id, agent_id,
                        name, kind, status_code, start_time_ns, end_time_ns, source
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT (trace_id, span_id, source) DO NOTHING
                    """,
                    span_rows,
                )
                # executemany returns a status string like "INSERT 0 N"; parse it
                try:
                    inserted_count = int(str(result).split()[-1]) if result else len(span_rows)
                except (ValueError, AttributeError, IndexError):
                    inserted_count = len(span_rows)

            if session_rows:
                await conn.executemany(
                    """
                    INSERT INTO sessions_v2 (session_id, org_id, agent_id, first_event_at, last_event_at)
                    VALUES ($1, $2, $3, NOW(), NOW())
                    ON CONFLICT (session_id) DO UPDATE SET last_event_at = NOW()
                    """,
                    session_rows,
                )

            if trace_rows:
                await conn.executemany(
                    """
                    INSERT INTO traces_v2 (trace_id, session_id, org_id, agent_id)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (trace_id) DO NOTHING
                    """,
                    trace_rows,
                )

            if usage_rows:
                await conn.executemany(
                    """
                    INSERT INTO usage_facts_v2 (
                        span_id, trace_id, session_id, org_id, agent_id,
                        model_name, prompt_tokens, completion_tokens, total_tokens,
                        event_date
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE)
                    ON CONFLICT DO NOTHING
                    """,
                    usage_rows,
                )

        unique_session_ids = list(seen_sessions.keys())
        if unique_session_ids:
            await self.update_session_rollups_v2_batch(unique_session_ids)

        return inserted_count

    async def update_session_rollups_v2_batch(self, session_ids: List[str]) -> None:
        """Call update_session_rollup_v2() for each session after a batch flush."""
        assert self.pool is not None, "Pool not initialised"
        async with self.pool.acquire() as conn:
            for sid in session_ids:
                try:
                    await conn.execute("SELECT update_session_rollup_v2($1)", sid)
                except Exception as e:
                    logger.warning(
                        "update_session_rollup_v2 failed for session %s: %s", sid, e
                    )
