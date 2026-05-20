from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace
from typing import Any, List
from unittest.mock import AsyncMock

import pytest

from remi_worker.config import Config
from remi_worker.consumer import KafkaConsumer


class FakeConsumer:
    def __init__(self, messages: List[Any]) -> None:
        self._messages = messages
        self._index = 0
        self.committed = False
        self.stopped = False

    def __aiter__(self) -> "FakeConsumer":
        return self

    async def __anext__(self) -> Any:
        if self._index >= len(self._messages):
            raise StopAsyncIteration

        message = self._messages[self._index]
        self._index += 1
        return message

    async def commit(self) -> None:
        self.committed = True

    async def stop(self) -> None:
        self.stopped = True


@pytest.fixture
def cfg() -> Config:
    return replace(Config(), batch_size=10, batch_timeout_s=1.0)


@pytest.fixture
def mock_db() -> AsyncMock:
    db = AsyncMock()
    db.store_events_batch.return_value = [{"id": 1, "session_id": "s1", "seq": 1}]
    db.store_sessions_batch.return_value = None
    db.update_session_metrics.return_value = None
    db.store_session.return_value = None
    db.load_model_pricing.return_value = {}
    db.store_spans_v2_from_events.return_value = 0
    return db


@pytest.mark.asyncio
async def test_flush_batch_preserves_org_id_for_metrics(
    mock_db: AsyncMock,
    cfg: Config,
) -> None:
    consumer = KafkaConsumer(db_pool=mock_db, cfg=cfg)
    consumer._consumer = FakeConsumer([])
    batch = [
        {
            "session_id": "s1",
            "org_id": "org-123",
            "event_type": "llm_end",
            "_seq": 1,
            "data": {
                "model": "gpt-4o",
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            },
        }
    ]

    await consumer._flush_batch(batch)

    mock_db.store_events_batch.assert_awaited_once_with(batch)
    metrics_delta = mock_db.update_session_metrics.await_args.args[0]
    assert metrics_delta["s1"]["org_id"] == "org-123"
    assert consumer._consumer.committed is True


@pytest.mark.asyncio
async def test_flush_batch_materializes_otlp_only_sessions(
    mock_db: AsyncMock,
    cfg: Config,
) -> None:
    consumer = KafkaConsumer(db_pool=mock_db, cfg=cfg)
    consumer._consumer = FakeConsumer([])
    mock_db.store_events_batch.return_value = [
        {"id": 1, "session_id": "otel-session", "seq": 1},
        {"id": 2, "session_id": "otel-session", "seq": 2},
    ]
    batch = [
        {
            "session_id": "otel-session",
            "org_id": "org-123",
            "event_type": "otel_span",
            "_seq": 1,
            "data": {
                "span_category": "llm",
                "model": "gpt-4o",
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            },
        },
        {
            "session_id": "otel-session",
            "agent_id": "agent-456",
            "event_type": "otel_span",
            "_seq": 2,
            "data": {
                "span_category": "tool",
                "tool_name": "search",
                "duration_ms": 25,
            },
        },
    ]

    await consumer._flush_batch(batch)

    mock_db.store_sessions_batch.assert_awaited_once_with(
        [{"session_id": "otel-session", "org_id": "org-123", "agent_id": "agent-456"}]
    )
    assert consumer._consumer.committed is True


@pytest.mark.asyncio
async def test_session_topic_passes_org_id_to_store_session(
    mock_db: AsyncMock,
    cfg: Config,
) -> None:
    consumer = KafkaConsumer(db_pool=mock_db, cfg=cfg)
    consumer._consumer = FakeConsumer(
        [
            SimpleNamespace(
                topic=cfg.kafka_session_topic,
                value={"session_id": "session-123", "org_id": "org-123"},
                partition=0,
                offset=0,
                key="session-123",
            )
        ]
    )

    await consumer.process_events()

    mock_db.store_session.assert_awaited_once_with("session-123", None, None, "org-123", None)
    assert consumer._consumer.stopped is True