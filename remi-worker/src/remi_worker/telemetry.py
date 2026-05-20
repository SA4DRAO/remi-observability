"""OpenTelemetry tracer bootstrap for remi-worker.

Call ``setup_tracing()`` once at process start (before ``asyncio.run(main())``)
to register a TracerProvider backed by OTLP HTTP export.

Environment variables:
    OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP HTTP base URL (default: http://localhost:4318)
    OTEL_SERVICE_NAME            — service name in traces (default: remi-worker)
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def setup_tracing() -> None:
    """Initialise TracerProvider with OTLP HTTP exporter.

    Safe to call even if the collector is unreachable — the SDK will log
    export warnings but will never raise or crash the worker.
    """
    try:
        from opentelemetry import trace  # type: ignore[import-not-found]
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # type: ignore[import-not-found]
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource  # type: ignore[import-not-found]
        from opentelemetry.sdk.trace import TracerProvider  # type: ignore[import-not-found]
        from opentelemetry.sdk.trace.export import BatchSpanProcessor  # type: ignore[import-not-found]
    except ImportError:
        logger.warning(
            "opentelemetry packages not installed; tracing disabled. "
            "Run: pip install opentelemetry-api opentelemetry-sdk "
            "opentelemetry-exporter-otlp-proto-http"
        )
        return

    _base = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318").rstrip("/")
    # Normalise: accept both base URL and full URL with /v1/traces already appended.
    endpoint = _base if _base.endswith("/v1/traces") else f"{_base}/v1/traces"
    service_name = os.getenv("OTEL_SERVICE_NAME", "remi-worker")

    resource = Resource.create({
        "service.name": service_name,
        # Marks all worker spans as internal Remi infrastructure so the
        # backend can filter them out and avoid creating junk sessions.
        "service.namespace": "remi-internal",
    })
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=endpoint)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    logger.info(
        "OTel tracing initialised: service=%s endpoint=%s",
        service_name,
        endpoint,
    )
