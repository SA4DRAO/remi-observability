# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install (editable with dev extras)
pip install -e ".[dev]"

# Run the worker
python -m remi_worker

# Tests
pytest                           # all tests
pytest tests/test_consumer.py   # single file
pytest -k "test_flush"          # single test by name
pytest -v                       # verbose

# Type checking
mypy src/
```

Tests use `pytest-asyncio` and do **not** require a running Kafka or Postgres — all external dependencies are replaced with `AsyncMock` / `FakeConsumer`.

## Architecture

### Module Responsibilities

**`config.py`** — `Config` dataclass reads everything from env vars with sensible defaults. Key values:
- `batch_size` (default 50, env `KAFKA_BATCH_SIZE`) — max events before flush
- `batch_timeout_s` (default 1.0s, env `KAFKA_BATCH_TIMEOUT`) — max seconds between flushes
- Both limits trigger flushing independently (whichever fires first)

**`consumer.py` — `KafkaConsumer`** — Core loop. Subscribes to both `remi-events` and `remi-sessions` topics. Session messages (`remi-sessions` topic) are stored immediately via `db.store_session`; event messages are batched then flushed.

**`db.py` — `DatabasePool`** — asyncpg connection pool. `store_events_batch` returns only the rows that were actually inserted (using `RETURNING` after `ON CONFLICT DO NOTHING`), which is the deduplication signal the consumer uses to avoid double-counting metrics.

**`metrics.py` — `compute_metrics_delta`** — Pure function. Takes a batch of events and a `PricingTable` dict, returns a dict of `{session_id: metrics_dict}` with additive deltas. Only called on the de-duplicated batch (rows actually inserted). Cost is computed from `model_pricing` table data; unknown models get cost = 0.

**`models.py` — `validate_kafka_event`** — Raises `ValueError` for invalid events. Invalid events are dead-lettered (logged, optionally traced) and skipped — the batch continues processing without them.

**`telemetry.py`** — Sets up OTel tracing via OTLP HTTP exporter. Optional at runtime; the consumer guards all OTel calls with `_OTEL_AVAILABLE`.

### Flush Lifecycle

```
_flush_batch(batch):
  1. _detect_gaps() — logs warnings for missing _seq numbers per session
  2. db.store_events_batch(batch) — INSERT … ON CONFLICT DO NOTHING, returns inserted rows
  3. Build deduplicated_batch from inserted rows (by session_id + seq key)
  4. db.store_sessions_batch() — upsert session stubs (ensures FK for events)
  5. compute_metrics_delta(deduplicated_batch) — additive aggregation
  6. db.update_session_metrics(delta) — UPSERT into session_metrics
  7. consumer.commit() — Kafka offset committed ONLY after successful DB writes
```

If any step raises, the flush retries up to 3 times with exponential backoff (0.5s, 1.0s, 2.0s). After exhausted retries the batch is logged as dropped and the Kafka offset is **not committed** — messages replay on restart. Sequenced events (`_seq`) are safe to replay; unsequenced events may produce duplicate DB rows.

### Deduplication

The `events` table has a partial unique index on `(session_id, seq) WHERE seq IS NOT NULL`. Only events with `_seq` can be deduplicated. The worker computes the metrics delta only from the inserted subset to prevent token/cost double-counting on replay.

### Sequence Gap Detection

Every event carries a monotonic `_seq` stamp set by the SDK. The consumer tracks `_last_seq` per session and logs a warning whenever a gap is detected. Gaps indicate events were dropped in transport (e.g. buffer overflow in the SDK).

### Pricing Cache

`model_pricing` rows are loaded from Postgres into `_pricing` on startup and refreshed every 10 minutes (`_PRICING_REFRESH_INTERVAL_S = 600`). Stale pricing is kept on refresh failure rather than cleared — a pricing miss costs zero, a stale price is better than no price.
