---
name: "testing"
description: "Test patterns for all Remi packages. USE FOR: writing tests, running tests, pytest fixtures, pytest-asyncio, monkeypatch httpx, AsyncMock asyncpg, FakeConsumer aiokafka, Node built-in test runner, Zod schema tests, remi-backend test, remi-langchain test, remi-worker test, test file naming, test commands."
---

# Testing Standards — Remi

## Quick Reference

| Package | Runner | Command | Prerequisite |
|---------|--------|---------|-------------|
| `remi-backend` | Node built-in `node:test` | `npm test` | `npm run build` (tests import from `dist/`) |
| `remi-langchain` | pytest | `make test` or `pytest tests/` | `pip install -e .[dev]` |
| `remi-worker` | pytest-asyncio | `pytest tests/` | `pip install -e .[dev]` |

## remi-backend — Node Built-in Test Runner

Tests live in `remi-backend/test/` as plain `.js` files. They import compiled output from `dist/`, so **always run `npm run build` before `npm test`**.

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { EventBatchSchema } = require('../dist/types/validation');

test('EventBatchSchema accepts valid batch', () => {
  const parsed = EventBatchSchema.parse({
    events: [{ event_type: 'llm_start' }],
    session_id: 'sess-1',
  });
  assert.equal(parsed.session_id, 'sess-1');
});
```

- Use `result.safeParse(...)` + `assert.equal(result.success, false)` to test schema rejection
- No mocking framework — inject test doubles directly or use module-level factories
- Run a single test file: `node --test test/validation.test.js`

## remi-langchain — pytest + monkeypatch

Tests live in `remi-langchain/tests/test_*.py`. Use `monkeypatch` for patching httpx internals.

**Transport test pattern** — build a minimal `EventTransport` and patch `_client.post`:
```python
def _make_transport(**overrides: object) -> EventTransport:
    return EventTransport(
        api_key="test-key",
        base_url="https://example.test",
        flush_interval_s=60.0,       # prevent background flush in tests
        enable_buffer_alerts=False,
        **overrides,
    )

def _response(status_code: int, *, json_body: object | None = None) -> httpx.Response:
    request = httpx.Request("POST", "https://example.test/api/v1/events/batch")
    return httpx.Response(status_code, request=request, json=json_body or {})

def test_retry_on_5xx(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = _make_transport(max_retries=2)
    responses = iter([_response(503), _response(200, json_body={"ok": True})])
    sleep_calls: list[float] = []

    monkeypatch.setattr(transport._client, "post", lambda *a, **kw: next(responses))
    monkeypatch.setattr("remi_langchain.transport.time.sleep", sleep_calls.append)

    result = transport._post([{"event_type": "test"}])
    assert result == {"ok": True}
    transport.close()   # always close to stop background thread
```

- Always call `transport.close()` in the test or use a `@pytest.fixture` with `yield` + `transport.close()`
- Use `@pytest.mark.parametrize` for exercising multiple status codes in one test function

## remi-worker — pytest-asyncio + AsyncMock

Tests live in `remi-worker/tests/test_*.py`. All async tests require `@pytest.mark.asyncio`.

**Config fixture** — use `dataclasses.replace(Config(), ...)` to override only relevant fields:
```python
@pytest.fixture
def cfg() -> Config:
    return replace(Config(), batch_size=10, batch_timeout_s=1.0)
```

**DB mock** — use `AsyncMock` matching the `DatabasePool` interface:
```python
@pytest.fixture
def mock_db() -> AsyncMock:
    db = AsyncMock()
    db.store_events_batch.return_value = [{"id": 1, "session_id": "s1", "seq": 1}]
    db.update_session_metrics.return_value = None
    db.store_session.return_value = None
    db.load_model_pricing.return_value = {}
    return db
```

**Fake Kafka consumer** — implement `__aiter__` / `__anext__` to yield test messages:
```python
class FakeConsumer:
    def __init__(self, messages: list[Any]) -> None:
        self._messages = messages
        self._index = 0
        self.committed = False

    def __aiter__(self) -> "FakeConsumer":
        return self

    async def __anext__(self) -> Any:
        if self._index >= len(self._messages):
            raise StopAsyncIteration
        msg = self._messages[self._index]
        self._index += 1
        return msg

    async def commit(self) -> None:
        self.committed = True

    async def stop(self) -> None:
        pass
```

- Never import `aiokafka` directly in test files — inject `FakeConsumer` via the constructor
- `asyncpg` connections are never opened in unit tests; always pass `AsyncMock` as `DatabasePool`
- Test `compute_metrics_delta` in isolation in `test_metrics.py` with plain dicts — no DB required

## Python Common Conventions (both packages)

- Test files: `tests/test_*.py` — pytest discovers only files matching this pattern
- All type annotations required — mypy runs over test files too (`disallow_untyped_defs = true`)
- Import `from __future__ import annotations` at the top of every test file
- Do NOT use `unittest.TestCase` — use plain functions and pytest fixtures
