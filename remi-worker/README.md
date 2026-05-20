# remi-worker

Python asyncio service that consumes events from Kafka, deduplicates them, and batch-flushes them to Postgres with per-session cost and token metrics.

---

## What it does

- Subscribes to `remi-events` and `remi-sessions` Kafka topics using `aiokafka`
- Accumulates messages into batches (flush triggered by batch size or timeout, whichever fires first)
- Validates each event against a schema; invalid events are dead-lettered (logged) and skipped
- Inserts events into Postgres using `ON CONFLICT DO NOTHING` to deduplicate replays
- Computes token and cost deltas from only the rows that were actually inserted
- Upserts `session_metrics` with additive aggregation
- Commits the Kafka offset only after a successful DB write — messages replay on crash
- Refreshes model pricing from the `model_pricing` table every 10 minutes

---

## Prerequisites

| Tool       | Version  |
|------------|----------|
| Python     | >= 3.9   |
| pip        | any      |
| Kafka      | 7.5 (Confluent) — provided by docker-compose |
| Postgres   | 16 — provided by docker-compose |

---

## Quick start (local, outside Docker)

```bash
cd remi-worker

# Create and activate a virtualenv
python -m venv .venv
source .venv/bin/activate

# Install package in editable mode with dev dependencies
pip install -e ".[dev]"

# Set required env vars (Kafka and Postgres must be reachable)
export KAFKA_BROKERS=localhost:9092
export DB_HOST=localhost
export DB_PASSWORD=remi_password

# Run the worker
python -m remi_worker
```

The worker logs each flush and any sequence gaps it detects.

---

## Development commands

```bash
pip install -e ".[dev]"        # install with pytest and mypy

python -m remi_worker          # run the worker

pytest                         # all tests (no Kafka or Postgres required)
pytest tests/test_consumer.py  # single test file
pytest -k "test_flush"         # single test by name
pytest -v                      # verbose output

mypy src/                      # type checking
```

Tests use `pytest-asyncio` with `AsyncMock` and `FakeConsumer` — no live infrastructure needed.

---

## Environment variables

| Variable                   | Default             | Purpose                                              |
|----------------------------|---------------------|------------------------------------------------------|
| `KAFKA_BROKERS`            | `kafka:29092`       | Comma-separated broker list                          |
| `KAFKA_EVENT_TOPIC`        | `remi-events`       | Kafka topic for event messages                       |
| `KAFKA_SESSION_TOPIC`      | `remi-sessions`     | Kafka topic for session messages                     |
| `KAFKA_GROUP_ID`           | `remi-worker-group` | Consumer group id                                    |
| `KAFKA_BATCH_SIZE`         | `50`                | Max events before flushing to DB                     |
| `KAFKA_BATCH_TIMEOUT`      | `1.0`               | Max seconds between flushes                          |
| `DB_HOST`                  | `postgres-primary`  | Postgres hostname                                    |
| `DB_PORT`                  | `5432`              | Postgres port                                        |
| `DB_USER`                  | `remi_user`         | Postgres user                                        |
| `DB_PASSWORD`              | `remi_password`     | Postgres password                                    |
| `DB_NAME`                  | `remi_db`           | Postgres database name                               |
| `DB_POOL_MIN`              | `5`                 | Min asyncpg connections                              |
| `DB_POOL_MAX`              | `20`                | Max asyncpg connections                              |
| `DB_POOL_ACQUIRE_TIMEOUT`  | `5`                 | Seconds to wait for a free connection                |
| `DB_STATEMENT_TIMEOUT_MS`  | `30000`             | Per-statement timeout (ms)                           |
| `LOG_LEVEL`                | `INFO`              | Logging verbosity                                    |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | OTel collector endpoint           |
| `OTEL_SERVICE_NAME`        | `remi-worker`       | Service name in traces                               |

---

## Flush lifecycle

```
_flush_batch(batch)
  1. Detect _seq gaps — warn on missing sequence numbers per session
  2. db.store_events_batch() — INSERT … ON CONFLICT DO NOTHING → returns inserted rows only
  3. Build deduplicated_batch from inserted rows
  4. db.store_sessions_batch() — upsert session stubs (FK guard)
  5. compute_metrics_delta(deduplicated_batch) — token/cost aggregation
  6. db.update_session_metrics(delta) — UPSERT session_metrics
  7. consumer.commit() — Kafka offset committed only after successful DB writes
```

On failure: retries up to 3 times with exponential backoff (0.5 s, 1.0 s, 2.0 s). After retries are exhausted the batch is logged as dropped and the offset is **not** committed — messages replay on next start.

---

## How it connects to other components

```
Kafka (remi-events, remi-sessions)
        │ AIOKafkaConsumer
        ▼
remi-worker
        │ asyncpg
        ▼
Postgres (events, session_metrics tables)
        ▲
        │ remi-backend reads for dashboard queries
```
