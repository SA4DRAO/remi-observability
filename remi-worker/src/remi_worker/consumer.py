"""Kafka consumer and main entry-point coroutine for remi-worker."""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from typing import Any, Dict, List, Optional

from .config import Config
from .db import DatabasePool
from .metrics import PricingTable, compute_metrics_delta
from .models import validate_kafka_event

try:
    from opentelemetry import trace  # type: ignore[import-not-found]
    from opentelemetry.propagate import extract as otel_extract  # type: ignore[import-not-found]
    from opentelemetry.trace import StatusCode  # type: ignore[import-not-found]

    _tracer = trace.get_tracer("remi-worker")
    _OTEL_AVAILABLE = True
except ImportError:
    _OTEL_AVAILABLE = False
    _tracer = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# How often to reload pricing from the DB (seconds).
_PRICING_REFRESH_INTERVAL_S = 600.0  # 10 minutes

# Retry policy for _flush_batch DB writes.
_MAX_FLUSH_RETRIES = 3
_FLUSH_RETRY_BASE_DELAY_S = 0.5  # yields 0.5s, 1.0s, 2.0s backoff


class KafkaConsumer:
    """Consume ``remi-events`` and ``remi-sessions`` topics, flush to Postgres in batches.

    Lifecycle::

        consumer = KafkaConsumer(db_pool, cfg)
        await consumer.initialize()
        await consumer.process_events()   # blocks until shutdown
    """

    def __init__(self, db_pool: DatabasePool, cfg: Config) -> None:
        self._db = db_pool
        self._cfg = cfg
        # Typed as Any so Pylance doesn't need aiokafka stubs in the local env;
        # the assert guards below narrow away None before use.
        self._consumer: Optional[Any] = None

        # Gap detection: last seen _seq per session_id.
        self._last_seq: Dict[str, int] = {}

        # In-memory pricing cache (loaded from model_pricing table).
        self._pricing: PricingTable = {}
        self._pricing_loaded_at: float = 0.0

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def initialize(self) -> None:
        """Start the AIOKafka consumer and join the consumer group."""
        try:
            from aiokafka import AIOKafkaConsumer as _AIOKafkaConsumer  # type: ignore[import-not-found]
        except ImportError as exc:
            logger.error("aiokafka is not installed. Run: pip install aiokafka")
            raise

        consumer = _AIOKafkaConsumer(
            self._cfg.kafka_event_topic,
            self._cfg.kafka_session_topic,
            bootstrap_servers=self._cfg.kafka_brokers,
            group_id=self._cfg.kafka_group_id,
            auto_offset_reset="earliest",
            enable_auto_commit=False,
            value_deserializer=lambda m: json.loads(m.decode("utf-8")),
            max_poll_records=self._cfg.batch_size,
            session_timeout_ms=30_000,
            request_timeout_ms=60_000,
        )
        await consumer.start()
        self._consumer = consumer
        assert self._consumer is not None  # narrows type for callers

        # Load model pricing into memory
        await self._refresh_pricing()

        logger.info(
            "Kafka consumer started (brokers=%s group=%s topics=%s/%s)",
            self._cfg.kafka_brokers,
            self._cfg.kafka_group_id,
            self._cfg.kafka_event_topic,
            self._cfg.kafka_session_topic,
        )
        logger.debug(
            "Consumer runtime config: batch_size=%d batch_timeout_s=%.2f auto_offset_reset=%s",
            self._cfg.batch_size,
            self._cfg.batch_timeout_s,
            "earliest",
        )

    async def stop(self) -> None:
        """Gracefully stop the consumer."""
        if self._consumer:
            await self._consumer.stop()
            logger.info("Kafka consumer stopped")
    async def _refresh_pricing(self) -> None:
        """Reload model pricing from the database."""
        try:
            self._pricing = await self._db.load_model_pricing()
            self._pricing_loaded_at = asyncio.get_running_loop().time()
            logger.debug(
                "Pricing cache refreshed: entries=%d loaded_at=%.3f",
                len(self._pricing),
                self._pricing_loaded_at,
            )
        except Exception as exc:
            logger.warning("Failed to refresh pricing: %s", exc)
            # Keep stale pricing rather than clearing it
    # ── Main loop ─────────────────────────────────────────────────────────

    async def process_events(self) -> None:
        """Consume messages indefinitely, flushing event batches to Postgres."""
        assert self._consumer is not None, "initialize() must be called before process_events()"
        batch: List[Dict[str, Any]] = []
        loop = asyncio.get_running_loop()
        last_flush = loop.time()

        try:
            async for message in self._consumer:
                try:
                    event: Dict[str, Any] = message.value
                    topic: str = message.topic

                    logger.debug(
                        "Received from topic=%s partition=%s offset=%d key=%s",
                        topic,
                        getattr(message, "partition", "?"),
                        message.offset,
                        getattr(message, "key", None),
                    )

                    # Extract W3C trace context injected by the backend Kafka producer.
                    _parent_ctx: Optional[Any] = None
                    if _OTEL_AVAILABLE and _tracer is not None:
                        _headers: Dict[str, str] = {}
                        for _hk, _hv in getattr(message, "headers", None) or []:
                            _hk_s = _hk if isinstance(_hk, str) else _hk.decode("utf-8", "replace")
                            _hv_s = _hv.decode("utf-8", "replace") if isinstance(_hv, bytes) else ""
                            _headers[_hk_s] = _hv_s
                        _parent_ctx = otel_extract(_headers)

                    if topic == self._cfg.kafka_session_topic:
                        session_id: str = event.get("session_id") or "unknown"
                        logger.info("Storing session: %s", session_id)
                        await self._db.store_session(
                            session_id,
                            event.get("name"),
                            event.get("metadata"),
                            event.get("org_id"),
                            event.get("agent_id"),
                        )
                    else:
                        try:
                            validate_kafka_event(event)
                        except ValueError as exc:
                            logger.error(
                                "Dead-letter: dropping invalid Kafka event "
                                "topic=%s partition=%s offset=%d error=%s "
                                "session_id=%s event_type=%s seq=%s",
                                topic,
                                getattr(message, "partition", "?"),
                                message.offset,
                                exc,
                                event.get("session_id", "<missing>"),
                                event.get("event_type", "<missing>"),
                                event.get("_seq", "<missing>"),
                            )
                            if _OTEL_AVAILABLE and _tracer is not None:
                                with _tracer.start_as_current_span(
                                    "remi.worker.dead_letter",
                                    context=_parent_ctx,
                                    attributes={
                                        "remi.session_id": event.get("session_id", "<missing>"),
                                        "remi.event_type": event.get("event_type", "<missing>"),
                                    },
                                ) as _dlq_span:
                                    _dlq_span.record_exception(exc)
                                    _dlq_span.set_status(
                                        StatusCode.ERROR, description=str(exc)
                                    )
                            continue
                        batch.append(event)
                        now = loop.time()

                        # Periodically refresh pricing cache
                        if (now - self._pricing_loaded_at) >= _PRICING_REFRESH_INTERVAL_S:
                            await self._refresh_pricing()

                        if (
                            len(batch) >= self._cfg.batch_size
                            or (now - last_flush) >= self._cfg.batch_timeout_s
                        ):
                            logger.debug(
                                "Flush trigger: size=%d elapsed=%.3fs",
                                len(batch),
                                now - last_flush,
                            )
                            if _OTEL_AVAILABLE and _tracer is not None:
                                with _tracer.start_as_current_span(
                                    "remi.worker.flush_batch",
                                    context=_parent_ctx,
                                    attributes={"remi.batch.size": len(batch)},
                                ):
                                    await self._flush_batch(batch)
                            else:
                                await self._flush_batch(batch)
                            batch = []
                            last_flush = loop.time()

                except json.JSONDecodeError as exc:
                    logger.error("Failed to decode Kafka message: %s", exc)
                except Exception as exc:
                    logger.error("Error processing message: %s", exc, exc_info=True)

        finally:
            if batch:
                logger.info("Flushing remaining %d events on shutdown", len(batch))
                if _OTEL_AVAILABLE and _tracer is not None:
                    with _tracer.start_as_current_span(
                        "remi.worker.flush_batch",
                        attributes={"remi.batch.size": len(batch), "remi.shutdown_flush": True},
                    ):
                        await self._flush_batch(batch)
                else:
                    await self._flush_batch(batch)
            await self.stop()

    # ── Batch flush ───────────────────────────────────────────────────────

    def _build_session_stubs(self, batch: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Collapse an event batch into one session stub per session_id."""
        sessions: Dict[str, Dict[str, Any]] = {}

        for event in batch:
            session_id = event.get("session_id")
            if not isinstance(session_id, str) or not session_id:
                continue

            stub = sessions.setdefault(
                session_id,
                {"session_id": session_id, "org_id": None, "agent_id": None},
            )

            if stub["org_id"] is None and event.get("org_id") is not None:
                stub["org_id"] = str(event["org_id"])

            if stub["agent_id"] is None and event.get("agent_id") is not None:
                stub["agent_id"] = str(event["agent_id"])

        return list(sessions.values())

    async def _flush_batch(self, batch: List[Dict[str, Any]]) -> None:
        """Write batch to ``events`` table and update ``session_metrics``.

        Only the events that were **actually inserted** (i.e. not skipped as
        duplicates) are fed into ``compute_metrics_delta``.  This prevents
        token/cost double-counting when the worker replays Kafka messages
        after an unclean shutdown.

        Events without a ``_seq`` value cannot be deduplicated by the DB
        and are always included in the metrics delta.

        Retry policy: up to ``_MAX_FLUSH_RETRIES`` attempts with exponential
        backoff on DB failures.  The Kafka offset is **not** committed on
        exhausted retries — messages will be reprocessed from the last
        committed offset on worker restart.  Events with ``_seq`` are safe
        to replay (ON CONFLICT DO NOTHING).  Events without ``_seq`` may
        produce duplicate rows if ``store_events_batch`` succeeded but
        ``update_session_metrics`` failed; this is a known limitation of
        unsequenced events.
        """
        assert self._consumer is not None, "initialize() must be called before _flush_batch()"
        started = asyncio.get_running_loop().time()
        # Detect sequence gaps before storing (pure logic, no retry needed)
        self._detect_gaps(batch)

        request_ids = sorted({
            str(e.get("ingest_request_id"))
            for e in batch
            if e.get("ingest_request_id")
        })

        last_exc: Optional[Exception] = None
        for attempt in range(1, _MAX_FLUSH_RETRIES + 1):
            try:
                inserted_rows = await self._db.store_events_batch(batch)

                # Build a set of (session_id, seq) pairs that were truly inserted.
                inserted_keys: set[tuple[str, int]] = {
                    (r["session_id"], r["seq"])
                    for r in inserted_rows
                    if r["seq"] is not None
                }
                # Keep events that were freshly inserted OR have no seq (can't dedup).
                deduplicated_batch = [
                    e for e in batch
                    if e.get("_seq") is None
                    or (e.get("session_id"), e.get("_seq")) in inserted_keys
                ]

                if len(deduplicated_batch) < len(batch):
                    logger.info(
                        "Dedup: computing metrics for %d/%d events (skipped %d duplicates)",
                        len(deduplicated_batch),
                        len(batch),
                        len(batch) - len(deduplicated_batch),
                    )

                await self._db.store_sessions_batch(self._build_session_stubs(batch))

                metrics_delta = compute_metrics_delta(deduplicated_batch, pricing=self._pricing)
                await self._db.update_session_metrics(metrics_delta)

                total_tokens = sum(int(m.get("total_tokens", 0) or 0) for m in metrics_delta.values())
                total_llm_calls = sum(int(m.get("llm_calls", 0) or 0) for m in metrics_delta.values())
                total_errors = sum(int(m.get("error_count", 0) or 0) for m in metrics_delta.values())
                logger.debug(
                    "Metrics updated: sessions=%s llm_calls=%d total_tokens=%d errors=%d ingest_request_ids=%s",
                    list(metrics_delta.keys()),
                    total_llm_calls,
                    total_tokens,
                    total_errors,
                    request_ids[:10],
                )

                # V2 write path: mirror to V2 tables for dashboard
                try:
                    await self._db.store_spans_v2_from_events(batch)
                except Exception as e:
                    logger.warning("V2 write failed (non-fatal): %s", e)

                await self._consumer.commit()
                logger.info(
                    "Flushed %d events (%d inserted, %d committed, %.2f ms)",
                    len(batch),
                    len(inserted_rows),
                    len(batch),
                    (asyncio.get_running_loop().time() - started) * 1000,
                )
                return  # success — exit retry loop

            except Exception as exc:
                last_exc = exc
                if attempt < _MAX_FLUSH_RETRIES:
                    delay = _FLUSH_RETRY_BASE_DELAY_S * (2 ** (attempt - 1))
                    logger.warning(
                        "_flush_batch attempt %d/%d failed, retrying in %.1fs: %s",
                        attempt,
                        _MAX_FLUSH_RETRIES,
                        delay,
                        exc,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        "_flush_batch failed after %d attempts, dropping %d events: %s",
                        _MAX_FLUSH_RETRIES,
                        len(batch),
                        last_exc,
                        exc_info=True,
                    )
                    # Do NOT commit — Kafka offset stays uncommitted so messages are reprocessed

    def _detect_gaps(self, batch: List[Dict[str, Any]]) -> None:
        """Log warnings for missing sequence numbers per session.

        The SDK stamps a monotonic ``_seq`` on every event.  Sequential
        gaps indicate events were dropped (e.g. transport buffer overflow).
        """
        # Group by session, sort by _seq within each group
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
                    gap = seq - last - 1
                    logger.warning(
                        "Sequence gap detected: session=%s expected_seq=%d got_seq=%d "
                        "(%d events missing)",
                        sid, last + 1, seq, gap,
                    )
                last = seq
            if seqs:
                self._last_seq[sid] = seqs[-1]


async def main() -> None:
    """Initialise all components and run the consumer loop."""
    cfg = Config()

    logging.basicConfig(
        level=cfg.log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger.info("=" * 60)
    logger.info("Starting Remi Background Worker")
    logger.info("  Kafka brokers : %s", cfg.kafka_brokers)
    logger.info("  DB host       : %s", cfg.db_host)
    logger.info("  DB name       : %s", cfg.db_name)
    logger.info("  Batch size    : %d events / %.1f s", cfg.batch_size, cfg.batch_timeout_s)
    logger.info("=" * 60)

    db_pool = DatabasePool(cfg)
    await db_pool.initialize()

    consumer = KafkaConsumer(db_pool, cfg)
    try:
        await consumer.initialize()
        logger.info("Kafka consumer ready — processing events…")
        await consumer.process_events()
    except KeyboardInterrupt:
        logger.info("Shutdown signal received")
    except Exception as exc:
        logger.error("Fatal error: %s", exc, exc_info=True)
        sys.exit(1)
    finally:
        await db_pool.close()
        logger.info("Worker shutdown complete")
