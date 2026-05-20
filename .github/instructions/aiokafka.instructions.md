---
name: "aiokafka"
description: "Python asyncio Kafka consumer using aiokafka, asyncpg DatabasePool for batch flushes, metrics delta computation with in-memory pricing cache, sequence gap detection via _last_seq tracking, and pytest-asyncio tests"
applyTo: "remi-worker/**/*.py"
---

# Async Kafka Worker Standards — remi-worker

## Module Structure & Imports

- Begin every source file with `from __future__ import annotations` — required for forward-reference compatibility across Python 3.10–3.12 and consistent with the rest of the codebase
- Use `logging.getLogger(__name__)` assigned to module-level `logger` (no underscore prefix in worker modules, matching the existing convention in `consumer.py`, `db.py`, and `metrics.py`)
- Import `aiokafka` lazily inside `initialize()` with a `try/except ImportError` — the optional import pattern lets the worker process start and emit a clear error rather than crashing at import time with a confusing traceback

```python
# every .py file in remi_worker/ — top-of-file template
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)
```

## Asyncio Discipline

- All I/O must use `async/await` — never call blocking functions (`time.sleep`, `requests.get`, synchronous `psycopg2` queries) inside a coroutine or the event loop will stall batch processing
- Use `asyncio.get_running_loop().time()` for monotonic timestamps inside coroutines — `time.time()` is fine for wall-clock logging but `loop.time()` is cheaper and skew-free for elapsed-duration checks
- Do not use `asyncio.create_task` for fire-and-forget work in the consumer loop unless the task is explicitly awaited or stored in a set; untracked tasks are silently cancelled on GC and cause hard-to-diagnose message loss

```python
# ✅ correct — fully async batch loop
async def process_events(self) -> None:
    batch: List[Dict[str, Any]] = []
    loop = asyncio.get_running_loop()
    last_flush = loop.time()

    async for message in self._consumer:
        batch.append(message.value)
        now = loop.time()
        if len(batch) >= self._cfg.batch_size or (now - last_flush) >= self._cfg.batch_timeout_s:
            await self._flush_batch(batch)
            batch = []
            last_flush = loop.time()

# ❌ wrong — blocks the event loop
import time
time.sleep(1)  # never inside a coroutine
```

## Kafka Consumer (aiokafka)

- Always instantiate `AIOKafkaConsumer` with `enable_auto_commit=False` — the worker calls `await self._consumer.commit()` manually only after a batch has been successfully written to Postgres and metrics have been updated; premature commits cause silent data loss on worker restart
- Read `batch_size` and `batch_timeout_s` from the `Config` dataclass — never hardcode batch parameters in the consumer class; they are tunable per deployment via environment variables
- Pass `max_poll_records=self._cfg.batch_size` to `AIOKafkaConsumer` to align the Kafka fetch size with the internal batch buffer — mismatches cause either under-utilised batches or excessive memory growth
- Subscribe to both `kafka_event_topic` and `kafka_session_topic` in a single consumer; dispatch by `message.topic` inside the loop

```python
async def initialize(self) -> None:
    try:
        from aiokafka import AIOKafkaConsumer as _AIOKafkaConsumer  # type: ignore[import-not-found]
    except ImportError:
        logger.error("aiokafka is not installed. Run: pip install aiokafka")
        raise

    consumer = _AIOKafkaConsumer(
        self._cfg.kafka_event_topic,
        self._cfg.kafka_session_topic,
        bootstrap_servers=self._cfg.kafka_brokers,
        group_id=self._cfg.kafka_group_id,
        auto_offset_reset="earliest",
        enable_auto_commit=False,           # manual commit after flush
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
        max_poll_records=self._cfg.batch_size,
        session_timeout_ms=30_000,
        request_timeout_ms=60_000,
    )
    await consumer.start()
    self._consumer = consumer
```

## Database Access (asyncpg via DatabasePool)

- All Postgres operations go through `DatabasePool` (defined in `db.py`) — never call `asyncpg.create_pool` or `asyncpg.connect` ad-hoc in consumer or metrics code; the pool manages connection lifecycle, timeouts, and min/max sizes from `Config`
- Follow the two-phase lifecycle: `await db_pool.initialize()` before the consumer starts, `await db_pool.close()` in the `finally` block of `main()` — missing `close()` leaks connections and causes the Postgres server to hit `max_connections`
- Access `self.pool` inside `DatabasePool` methods only — external callers use the `DatabasePool` interface (`store_events_batch`, `update_session_metrics`, `load_model_pricing`, `store_session`)

```python
# src/remi_worker/__main__.py — correct lifecycle
async def main() -> None:
    cfg = Config()
    db_pool = DatabasePool(cfg)
    await db_pool.initialize()

    consumer = KafkaConsumer(db_pool, cfg)
    try:
        await consumer.initialize()
        await consumer.process_events()
    except KeyboardInterrupt:
        logger.info("Shutdown signal received")
    except Exception as exc:
        logger.error("Fatal error: %s", exc, exc_info=True)
        sys.exit(1)
    finally:
        await db_pool.close()   # always reached via try/finally
```

## Metrics Delta Computation

- Call `compute_metrics_delta(batch, pricing=self._pricing)` from `metrics.py` **only on the deduplicated batch** (events that were actually inserted, not skipped as duplicates) — passing the raw batch double-counts tokens and cost for replayed messages after an unclean shutdown
- Maintain the in-memory `PricingTable` cache (`self._pricing: PricingTable`) and refresh it via `_refresh_pricing()` every `_PRICING_REFRESH_INTERVAL_S` seconds (currently 600 s); check elapsed time with `loop.time()` inside the consume loop — not a separate `asyncio.Task` to avoid task-tracking complexity
- When `_refresh_pricing()` fails, log a warning and keep the stale cache rather than clearing it — unknown models default to cost `0.0` in `_compute_cost`, so stale pricing is safer than no pricing

```python
# correct deduplication before metrics — mirrors _flush_batch in consumer.py
inserted_rows = await self._db.store_events_batch(batch)
inserted_keys: set[tuple[str, int]] = {
    (r["session_id"], r["seq"])
    for r in inserted_rows
    if r["seq"] is not None
}
deduplicated_batch = [
    e for e in batch
    if e.get("_seq") is None
    or (e.get("session_id"), e.get("_seq")) in inserted_keys
]
metrics_delta = compute_metrics_delta(deduplicated_batch, pricing=self._pricing)
await self._db.update_session_metrics(metrics_delta)
```

## Sequence Gap Detection

- Track the last seen `_seq` per `session_id` in `self._last_seq: Dict[str, int]` — this is an instance variable on `KafkaConsumer`, not a module global, so multiple consumer instances in tests are isolated
- In `_detect_gaps`, sort each session's sequences before comparing — Kafka does not guarantee per-session ordering across partitions; unsorted comparison produces spurious gap warnings
- Log sequence gaps with `logger.warning` including `session`, `expected_seq`, `got_seq`, and the gap count — **never raise an exception** for gaps; missing events are a data-quality signal, not a processing error, and raising would halt the consumer
- Call `_detect_gaps(batch)` before `store_events_batch` so the gap log precedes any DB errors in the log stream

```python
def _detect_gaps(self, batch: List[Dict[str, Any]]) -> None:
    by_session: Dict[str, List[int]] = {}
    for event in batch:
        sid = event.get("session_id") or "unknown"
        seq = event.get("_seq")
        if seq is not None:
            by_session.setdefault(sid, []).append(int(seq))

    for sid, seqs in by_session.items():
        seqs.sort()
        last = self._last_seq.get(sid)
        for seq in seqs:
            if last is not None and seq > last + 1:
                logger.warning(
                    "Sequence gap detected: session=%s expected_seq=%d got_seq=%d (%d events missing)",
                    sid, last + 1, seq, seq - last - 1,
                )
            last = seq
        if seqs:
            self._last_seq[sid] = seqs[-1]
        # ✅ never raise — gap is logged, not fatal
```

## Testing

- Mark every test coroutine with `@pytest.mark.asyncio` and install `pytest-asyncio`; add `asyncio_mode = "auto"` to `[tool.pytest.ini_options]` if the project moves to pytest-asyncio ≥ 0.21 to avoid per-test decoration
- Mock `asyncpg` pool operations with `unittest.mock.AsyncMock` or a dedicated fixture — never let tests connect to a real Postgres instance; tests must be runnable with no external services
- Use `pytest` fixtures to build `Config` and `DatabasePool` stubs rather than instantiating them inline — fixtures are reusable and surface config drift early
- Test gap detection in isolation by calling `consumer._detect_gaps(batch)` directly with a constructed batch — it is a pure sync method with no I/O dependencies

```python
# tests/test_consumer.py — asyncpg mock pattern
import pytest
from unittest.mock import AsyncMock
from remi_worker.consumer import KafkaConsumer
from remi_worker.config import Config

@pytest.fixture
def mock_db() -> AsyncMock:
    db = AsyncMock()
    db.store_events_batch.return_value = [{"session_id": "s1", "seq": 1}]
    db.update_session_metrics.return_value = None
    db.load_model_pricing.return_value = {}
    return db

@pytest.fixture
def cfg() -> Config:
    return Config(
        kafka_brokers="localhost:9092",
        batch_size=10,
        batch_timeout_s=1.0,
    )

@pytest.mark.asyncio
async def test_flush_batch_updates_metrics(mock_db: AsyncMock, cfg: Config) -> None:
    consumer = KafkaConsumer(db_pool=mock_db, cfg=cfg)
    consumer._consumer = AsyncMock()  # mock commit
    await consumer._flush_batch([{"session_id": "s1", "_seq": 1, "event_type": "llm_end"}])
    mock_db.update_session_metrics.assert_awaited_once()

def test_detect_gaps_logs_warning(caplog: pytest.LogCaptureFixture, mock_db: AsyncMock, cfg: Config) -> None:
    consumer = KafkaConsumer(db_pool=mock_db, cfg=cfg)
    consumer._last_seq = {"s1": 2}
    batch = [{"session_id": "s1", "_seq": 5}]   # gap: 3, 4 are missing
    with caplog.at_level("WARNING"):
        consumer._detect_gaps(batch)
    assert "Sequence gap detected" in caplog.text
    assert consumer._last_seq["s1"] == 5
```
