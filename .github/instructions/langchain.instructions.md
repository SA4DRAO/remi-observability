---
name: "langchain"
description: "Python LangChain SDK extending BaseCallbackHandler, EventTransport HTTP delivery with httpx, strict mypy type annotations (disallow_untyped_defs), ruff/black linting (line-length 100), and pytest tests in tests/ with test_*.py naming"
applyTo: "remi-langchain/**/*.py"
---

# LangChain Callback Library Standards — remi-langchain

## Module Structure & Imports

- Begin every source file with `from __future__ import annotations` — this enables PEP 563 postponed evaluation of annotations and is required for forward-reference compatibility across Python 3.10–3.12
- Use `logging.getLogger(__name__)` assigned to `_logger` (underscore-prefixed) at module level — the leading underscore signals that this is a private module constant, consistent with `callbacks.py` and `transport.py`
- Import standard-library `typing` members explicitly (`Dict`, `List`, `Optional`, `Any`, `TypedDict`, `Sequence`) rather than using PEP 585 generics (`dict[str, ...]`) for Python 3.10 compatibility — the `pyproject.toml` targets `python_version = "3.10"`

```python
# every .py file in remi_langchain/ — top-of-file template
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

_logger = logging.getLogger(__name__)
```

## BaseCallbackHandler Subclasses

- All callback handlers must inherit from `langchain_core.callbacks.BaseCallbackHandler` — never subclass the deprecated `langchain.callbacks.base.BaseCallbackHandler`
- Async handler methods (`on_llm_start`, `on_llm_end`, `on_tool_start`, etc.) must match the exact signatures defined by `langchain-core` including `**kwargs: Any` — extra keyword arguments are forwarded by LangChain and will cause `TypeError` if the signature is stricter
- Extract `run_id` from `kwargs` via a helper (see `_run_id` in `callbacks.py`) rather than positional access — LangChain's callback dispatch is not positionally stable across minor versions
- Never block the event loop in callback methods; offload I/O to `EventTransport` which handles buffering and background delivery

```python
from langchain_core.callbacks import BaseCallbackHandler
from typing import Any, Dict, List, Optional
from uuid import UUID

class DataCallbackHandler(BaseCallbackHandler):
    def __init__(self, transport: EventTransport) -> None:
        super().__init__()
        self._transport = transport

    async def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        event: Dict[str, Any] = {
            "event_type": "llm_start",
            "run_id": str(run_id),
            "model": _extract_name(serialized),
        }
        self._transport.send(event)   # non-blocking buffer append

    async def on_llm_end(
        self,
        response: Any,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        # always annotate return type explicitly
        ...
```

## HTTP Transport (httpx)

- Use `httpx.AsyncClient` for all HTTP delivery — never import `requests` or `urllib`; `httpx` is the sole declared HTTP dependency in `pyproject.toml`
- Configure the client with explicit `base_url`, `timeout`, and transport-level retry settings at construction time — do not create ad-hoc clients per request as connection-pool setup is expensive
- Wrap all `httpx` calls in `try/except` and update the `dropped_event_count` counter on permanent failures — the public `send`/`flush`/`close` API must never raise into caller code (see `transport.py` docstring contract)
- Raise custom exceptions (`RemiTransportError` subclasses) internally for control flow; let `__init__.py`-exported classes remain exception-free to end users

```python
import httpx

class EventTransport:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_s: float = 10.0,
        max_retries: int = 3,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(timeout_s),
        )
        self._max_retries = max_retries

    async def _deliver(self, payload: bytes) -> None:
        for attempt in range(self._max_retries):
            try:
                resp = await self._client.post("/ingest", content=payload)
                resp.raise_for_status()
                return
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code < 500:
                    raise PermanentTransportError(
                        status_code=exc.response.status_code,
                        reason=str(exc),
                        response_excerpt=exc.response.text[:200],
                    )
                _logger.warning("Transient error (attempt %d): %s", attempt + 1, exc)
            except httpx.TransportError as exc:
                _logger.warning("Network error (attempt %d): %s", attempt + 1, exc)
```

## Type Annotations & mypy

- `disallow_untyped_defs = true` is enforced by `mypy` (see `pyproject.toml`); every function and method — including private helpers — must have fully annotated parameters and return types
- `strict_optional = true` is enabled; never assume an `Optional` value is non-`None` without an explicit guard; use `if x is not None` not truthiness checks for zero-valued types
- Use `TypedDict` for structured dictionaries that cross module boundaries (e.g. event payloads) instead of `Dict[str, Any]` where the shape is known
- Annotate `**kwargs: Any` on every `BaseCallbackHandler` override — mypy will otherwise flag missing parameter annotations even when the base class uses `Any`

```python
from typing import TypedDict

class LLMStartEvent(TypedDict):
    event_type: str
    run_id: str
    session_id: str
    model: str
    timestamp_ms: int

def _build_llm_start_event(
    run_id: str,
    session_id: str,
    model: str,
) -> LLMStartEvent:   # explicit return type required by disallow_untyped_defs
    return {
        "event_type": "llm_start",
        "run_id": run_id,
        "session_id": session_id,
        "model": model,
        "timestamp_ms": _now_ms(),
    }
```

## Code Formatting

- `black` (line-length 100) is the formatter; `ruff` (line-length 100, rules `E F I N UP B SIM`) is the linter — both are configured in `pyproject.toml` and must pass before a PR is merged
- Run `black src/ tests/ && ruff check src/ tests/` locally before committing; the `Makefile` exposes these as targets
- Import order follows `ruff`'s `I` (isort) rule: stdlib → third-party → local, each group separated by a blank line
- Maximum line length is 100 characters — this is a deliberate project choice to accommodate deeply nested LangChain callback signatures without excessive line wrapping

```python
# ✅ correct import order (ruff I rule)
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from langchain_core.callbacks import BaseCallbackHandler

from .transport import EventTransport

# ❌ unsorted / missing blank lines will fail ruff
import json
from .transport import EventTransport
import logging
```

## Public API & __init__.py

- Every symbol intended for external use must be listed in `remi_langchain/__init__.py` under `__all__` — the current exports are `DataCallbackHandler`, `Event`, `StreamingRemiHandler`, and `__version__`
- New public classes or functions added to any module in `src/remi_langchain/` must be imported and re-exported from `__init__.py` in the same PR — callers import from `remi_langchain`, never from sub-modules directly
- Internal helpers (prefixed with `_`) must not be added to `__all__` even if technically importable

```python
# remi_langchain/__init__.py — update when adding public symbols
from .callbacks import DataCallbackHandler, Event, StreamingRemiHandler
# from .new_module import NewPublicClass   ← add here

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "DataCallbackHandler",
    "Event",
    "StreamingRemiHandler",
    # "NewPublicClass",  ← add here
]
```

## Testing

- All tests live in `tests/` at the repo root with filenames matching `test_*.py` — this is required by `[tool.pytest.ini_options] testpaths = ["tests"]` in `pyproject.toml`
- Mock HTTP calls with `respx` or `httpx.MockTransport` — never let tests make real network calls; `httpx`'s transport layer is designed to be replaced in tests
- Use `pytest.mark.asyncio` for any test that awaits coroutines; install `pytest-asyncio` in the dev dependencies
- Assert on structured event dictionaries rather than string representations; the `Event` TypedDict gives precise field-level assertions

```python
# tests/test_transport.py — httpx mock pattern
import pytest
import httpx
import respx

from remi_langchain import DataCallbackHandler
from remi_langchain.transport import EventTransport

@respx.mock
@pytest.mark.asyncio
async def test_delivery_retries_on_503() -> None:
    route = respx.post("http://localhost:8000/ingest").mock(
        side_effect=[
            httpx.Response(503),
            httpx.Response(503),
            httpx.Response(200),
        ]
    )
    transport = EventTransport(base_url="http://localhost:8000", max_retries=3)
    await transport._deliver(b'{"events": []}')
    assert route.call_count == 3
```
