---
name: "aiokafka"
description: "Python asyncio Kafka consumer worker for Remi using aiokafka and asyncpg, with batch processing, incremental session metrics, and sequence-gap detection. USE FOR: aiokafka consumer, KafkaConsumer, kafka topics remi-events remi-sessions, batch processing, flush batch, asyncpg, DatabasePool, session metrics, compute_metrics_delta, metrics delta, pricing cache, model_pricing, sequence gap detection, _last_seq, event deduplication, jsonb_add_counts, remi-worker, asyncio event loop, pytest-asyncio, worker config, Config dataclass, batch_size, batch_timeout_s. DO NOT USE FOR: React components, Express routes, langchain callbacks, httpx, Node.js code, TypeScript, Vite."
argument-hint: "[consumer, metrics, or database topic]"
user-invokable: true
---

# Remi Worker (aiokafka + asyncpg)

Standalone Python asyncio service at `remi-worker/`. Consumes two Kafka topics, bulk-inserts events into PostgreSQL, and upserts incremental session metrics — all without a read-modify-write cycle.

## Architecture Overview

```
remi-worker/src/remi_worker/
├── consumer.py   # KafkaConsumer — main loop, batch flush, gap detection
├── db.py         # DatabasePool — asyncpg pool, idempotent event insert, metrics upsert
├── metrics.py    # compute_metrics_delta() — pure function, no I/O
├── config.py     # Config dataclass — all config from env vars
└── __init__.py / __main__.py

tests/             # pytest-asyncio test files
main.py            # Entry point: wires Config → DatabasePool → KafkaConsumer
```

## Key Components

### Config (config.py)
Environment-driven `@dataclass` — always injected via constructor, never read `os.getenv` inside business logic:
```python
cfg = Config()           # reads DB_HOST, KAFKA_BROKERS, KAFKA_BATCH_SIZE, etc.
db_pool = DatabasePool(cfg)
consumer = KafkaConsumer(db_pool, cfg)
```
Key tunables: `cfg.batch_size` (default 100), `cfg.batch_timeout_s` (default 1.0 s).

### KafkaConsumer (consumer.py)
```
consumer.initialize()     → starts AIOKafkaConsumer, joins group, loads pricing
consumer.process_events() → async for message loop; flushes when batch full or timeout
consumer._flush_batch()   → detect gaps → store_events_batch → compute_metrics_delta → update_session_metrics → commit
consumer._detect_gaps()   → updates _last_seq[session_id], logs WARN on missing seqs
consumer.stop()           → graceful shutdown
```
Topics: `remi-events` (events batch) and `remi-sessions` (session upsert, stored immediately without batching).

### DatabasePool (db.py)
```python
await pool.store_events_batch(events)      # UNNEST bulk insert; ON CONFLICT(session_id, seq) DO NOTHING
                                            # returns only freshly inserted rows [{id, session_id, seq}]
await pool.update_session_metrics(delta)   # additive UPSERT; uses jsonb_add_counts() for JSONB breakdowns
await pool.store_session(id, name, meta)   # ON CONFLICT DO UPDATE
await pool.load_model_pricing()            # → PricingTable dict for cost computation
```

### compute_metrics_delta (metrics.py)
Pure function — no I/O, fully testable:
```python
delta = compute_metrics_delta(events, pricing=pricing_table)
# Returns: {session_id: {total_events, llm_calls, tool_calls, error_count,
#           prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd,
#           total_llm_duration_ms, total_tool_duration_ms, max_agent_iteration,
#           finish_reasons, tool_usage, model_usage, event_type_counts,
#           first_event_at, last_event_at, is_complete, has_error}}
```
Event types handled: `llm_end`, `llm_start`, `tool_end`, `tool_error`, `llm_error`, `chain_error`, `retriever_error`, `chain_end`.

## Decision Tree

```
Adding a new Kafka topic handler?
└─ Add elif topic == cfg.kafka_foo_topic branch in process_events()
   → For session-like (one-off) events: await db.store_* immediately (no batch)
   → For high-volume events: append to batch list, flush on threshold

Extending metrics computation?
└─ Add elif etype == "new_event_type" block in compute_metrics_delta()
   → All fields are additive counters or JSONB dicts — keep it that way
   → Write a unit test with a synthetic event list (no DB needed)

Adding a new DB operation?
└─ Add method to DatabasePool using pool.acquire() context manager
   → Annotate asyncpg result casts explicitly: r["col_name"] as int / str
   → Catch asyncpg.exceptions.QueryCanceledError, log, and re-raise
   → Always assert self.pool is not None at method entry

Writing an async test?
└─ Use pytest-asyncio; inject a mock DatabasePool (don't create real pool)
   → Patch pricing table with {} or a fixture dict for cost tests
```

## Common Pitfalls

- ❌ Don't call blocking I/O (e.g. `time.sleep`, `requests.get`) inside the consumer — ✅ Use `await asyncio.sleep` and `httpx.AsyncClient`; blocking the event loop stalls all Kafka consumption.
- ❌ Don't use ad-hoc `asyncpg.connect()` calls — ✅ Always go through `DatabasePool`; it handles pool sizing, timeouts, and graceful shutdown.
- ❌ Don't compute metrics from the full `batch` after `store_events_batch` — ✅ Feed only `deduplicated_batch` (events actually inserted) into `compute_metrics_delta` to prevent double-counting on replay.
- ❌ Don't forget `await consumer.commit()` inside `_flush_batch` — ✅ Kafka offsets are committed only after a successful DB write; omitting it causes replays on restart.
- ❌ Don't omit `assert self.pool is not None` before `pool.acquire()` — ✅ mypy requires it; asyncpg raises a misleading `AttributeError` on `None` otherwise.
