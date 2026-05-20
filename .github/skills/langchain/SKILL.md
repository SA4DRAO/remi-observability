---
name: "langchain"
description: "Python LangChain observability SDK for Remi using BaseCallbackHandler and httpx EventTransport. USE FOR: langchain callbacks, BaseCallbackHandler, DataCallbackHandler, StreamingRemiHandler, on_llm_start, on_llm_end, on_tool_start, on_tool_end, on_chain_end, on_llm_error, EventTransport, httpx, callback handler methods, langchain-core, llm observability, tracing, session events, python sdk, mypy types, ruff linting, pytest transport tests, respx mocking, _normalize_usage, _extract_name. DO NOT USE FOR: React components, Express routes, aiokafka consumer, asyncpg, Node.js code, TypeScript."
argument-hint: "[handler method or transport topic]"
user-invokable: true
---

# Remi LangChain SDK

Python library at `remi-langchain/`. Implements `BaseCallbackHandler` subclasses that stream lifecycle events to the Remi backend via a resilient `EventTransport`.

## Architecture Overview

```
remi-langchain/src/remi_langchain/
├── callbacks.py     # DataCallbackHandler, StreamingRemiHandler (BaseCallbackHandler subclasses)
├── transport.py     # EventTransport — batching, gzip, retry/backoff, gap detection
├── __init__.py      # Public API: DataCallbackHandler, Event, StreamingRemiHandler
└── py.typed         # PEP 561 marker

tests/
├── test_callbacks.py
├── test_transport.py
└── conftest.py      # respx mock fixtures
```

## Public API

```python
from remi_langchain import DataCallbackHandler, StreamingRemiHandler, Event

handler = DataCallbackHandler(
    session_id="my-session",
    transport=EventTransport(base_url="http://localhost:3000", api_key="...")
)
```

All three symbols are exported from `__init__.py` — always add new public classes there.

## Key Conventions

**Callback handler methods** — every `on_*` override is `async` with full mypy annotations:
```python
async def on_llm_end(
    self,
    response: LLMResult,
    *,
    run_id: UUID,
    **kwargs: Any,
) -> None:
    usage = _normalize_usage(response.llm_output)
    await self._transport.send({
        "event_type": "llm_end",
        "session_id": self._session_id,
        "data": {"usage": usage, "model": ..., "duration_ms": ...},
    })
```

**`_normalize_usage(raw)`** — always call this on any token-usage object before sending. Handles OpenAI dicts (`prompt_tokens`/`completion_tokens`), Anthropic aliases (`input_tokens`/`output_tokens`), Pydantic models, and objects with `__dict__`. Returns a canonical `{"prompt_tokens": int, "completion_tokens": int, "total_tokens": int}` or `None`.

**`_extract_name(serialized)`** — call this on LangChain's `serialized` dict (passed to `on_llm_start`, `on_chain_start`, etc.) to get a human-readable model/chain name.

**`EventTransport`** reliability contract:
- Buffers events in-memory; flushes in gzip-compressed batches.
- Retries with exponential backoff on transient errors.
- Drops oldest events when buffer is full (`BufferOverflowError`).
- Never raises into caller code from `send()` / `flush()` / `close()`.
- Registers an `atexit` hook to drain remaining events on clean exit.

**Transport exceptions** (only raised from internal flush; not from `send()`):
| Class | When |
|---|---|
| `BufferOverflowError` | Buffer capacity exceeded |
| `BackendUnavailableError` | Max retries exhausted |
| `PermanentTransportError` | Backend returned non-retryable 4xx |

## Decision Tree

```
Adding a new LangChain lifecycle event?
└─ Add async on_<event>(self, ..., **kwargs) to DataCallbackHandler
   → Call _normalize_usage / _extract_name as appropriate
   → Build event dict with event_type, session_id, data: {...}
   → await self._transport.send(event)
   → Add a test using respx to mock the HTTP call

Adding a new field to an existing event?
└─ Update the data: {...} dict in the handler
   → Update the corresponding test assertion
   → If it's a token/model field, check _normalize_usage first

Need to mock HTTP in tests?
└─ Use respx (not unittest.mock) — see tests/conftest.py for fixture
   → respx.mock + respx.post(url).mock(return_value=...) pattern
```

## Common Pitfalls

- ❌ Don't use `requests` or `urllib` — ✅ Use `httpx.AsyncClient`; the transport is fully async and `requests` would block the event loop.
- ❌ Don't omit return type annotations on handler methods — ✅ mypy strict mode is enforced; unannotated functions cause CI failures.
- ❌ Don't add a new public class without updating `__init__.py` and `__all__` — ✅ Users import from `remi_langchain` directly; anything not in `__all__` is invisible.
- ❌ Don't call `_normalize_usage` with `response.generations` — ✅ Pass `response.llm_output` (the usage dict lives there, not in generations).
- ❌ Don't `await transport.send()` inside a `try/except` that swallows all exceptions — ✅ `send()` never raises; catching broadly masks bugs in the event-building code above it.
