"""Shared OpenTelemetry setup for Remi examples.

Emits OTLP traces directly using standard packages:
- opentelemetry-sdk
- opentelemetry-exporter-otlp-proto-http

LangChain spans are created via RemiCallback (BaseCallbackHandler), which avoids
the version incompatibilities of opentelemetry-instrumentation-langchain.
"""

from __future__ import annotations

import json
import os
from contextvars import ContextVar
from typing import Any, Optional
from uuid import UUID

from opentelemetry import context, trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace import SpanProcessor
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.trace import Span, SpanKind, StatusCode

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

_CONFIGURED = False

_session_id_var: ContextVar[Optional[str]] = ContextVar("_remi_session_id", default=None)
_conversation_id_var: ContextVar[Optional[str]] = ContextVar("_remi_conversation_id", default=None)
_prompt_version_var: ContextVar[Optional[str]] = ContextVar("_remi_prompt_version", default=None)
_provider_var: ContextVar[Optional[str]] = ContextVar("_remi_provider", default=None)


def set_session_id(session_id: str) -> None:
    """Call immediately before each agent invocation to stamp all spans with the session id."""
    _session_id_var.set(session_id)


def set_conversation_id(conversation_id: str) -> None:
    """Link this session to a multi-turn conversation.
    The same conversation_id across multiple sessions stitches them together in the UI."""
    _conversation_id_var.set(conversation_id)


def set_prompt_version(version: str) -> None:
    """Stamp all spans with a prompt version identifier (e.g. 'v1', 'sha:abc123').
    Enables comparing which prompt version produces better outcomes in AnalyticsPage."""
    _prompt_version_var.set(version)


def set_provider(provider: str) -> None:
    """Explicitly set the LLM provider stamped on all spans as gen_ai.system.
    Overrides the value auto-detected from the model name (e.g. 'openai', 'anthropic', 'google')."""
    _provider_var.set(provider)


class _MetadataSpanProcessor(SpanProcessor):
    """Injects session_id, conversation_id, prompt_version, and provider from ContextVars into every span."""

    def on_start(self, span: Span, parent_context: Optional[context.Context] = None) -> None:
        session_id = _session_id_var.get()
        if session_id is not None:
            span.set_attribute("remi.session_id", session_id)
        conversation_id = _conversation_id_var.get()
        if conversation_id is not None:
            span.set_attribute("gen_ai.conversation.id", conversation_id)
        prompt_version = _prompt_version_var.get()
        if prompt_version is not None:
            span.set_attribute("remi.prompt_version", prompt_version)
        provider = _provider_var.get()
        if provider is not None:
            span.set_attribute("gen_ai.system", provider)

    def on_end(self, span: ReadableSpan) -> None:
        pass

    def shutdown(self) -> None:
        pass

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True


class RemiCallback(BaseCallbackHandler):
    """LangChain callback that creates OTel child spans for LLM and tool invocations.

    Attach to a chain or agent via the `callbacks` argument:
        chain.invoke(inputs, config={"callbacks": [RemiCallback(tracer)]})

    Or set globally:
        llm = ChatOpenAI(..., callbacks=[RemiCallback(tracer)])
    """

    def __init__(self, tracer: trace.Tracer) -> None:
        super().__init__()
        self._tracer = tracer
        # Maps run_id → (span, token) so we can end the right span on completion
        self._llm_spans: dict[str, tuple[Span, object]] = {}
        self._tool_spans: dict[str, tuple[Span, object]] = {}
        self._chain_spans: dict[str, tuple[Span, object]] = {}

    # ── LLM ─────────────────────────────────────────────────────────────────

    def _begin_llm_span(self, run_id: UUID, model: str) -> None:
        span = self._tracer.start_span(
            "ChatModel",
            kind=SpanKind.CLIENT,
            attributes={
                "gen_ai.system": _infer_provider(model),
                "gen_ai.request.model": model,
                "remi.span_type": "llm",
            },
        )
        ctx = trace.set_span_in_context(span)
        token = context.attach(ctx)
        self._llm_spans[str(run_id)] = (span, token)

    def on_chat_model_start(
        self,
        serialized: Any,
        messages: list,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        """Called by ChatOpenAI and other chat models in LangChain 0.3+."""
        sr = serialized if isinstance(serialized, dict) else {}
        model = (
            (sr.get("kwargs") or {}).get("model_name")
            or (sr.get("kwargs") or {}).get("model")
            or kwargs.get("invocation_params", {}).get("model_name")
            or "unknown"
        )
        self._begin_llm_span(run_id, model)
        # Capture prompt — messages is a list-of-lists (one per completion candidate)
        span, _ = self._llm_spans[str(run_id)]
        try:
            msg_list = messages[0] if messages else []
            parts = []
            for m in msg_list:
                role = getattr(m, "type", None) or getattr(m, "role", "message")
                content = m.content if isinstance(getattr(m, "content", None), str) else ""
                if content:
                    parts.append(f"{role}: {content}")
            if parts:
                span.set_attribute("llm.prompt", "\n---\n".join(parts)[:4096])
        except Exception:
            pass

    def on_llm_start(
        self,
        serialized: Any,
        prompts: list[str],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        """Called by completion-style LLMs (non-chat). Fallback for older models."""
        sr = serialized if isinstance(serialized, dict) else {}
        model = (
            (sr.get("kwargs") or {}).get("model_name")
            or kwargs.get("invocation_params", {}).get("model_name")
            or "unknown"
        )
        self._begin_llm_span(run_id, model)

    def on_llm_end(self, response: LLMResult, *, run_id: UUID, **kwargs: Any) -> None:
        key = str(run_id)
        if key not in self._llm_spans:
            return
        span, token = self._llm_spans.pop(key)
        try:
            usage = (response.llm_output or {}).get("token_usage") or {}
            prompt_tokens = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
            completion_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
            total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))
            if total_tokens > 0:
                span.set_attribute("gen_ai.usage.prompt_tokens", prompt_tokens)
                span.set_attribute("gen_ai.usage.completion_tokens", completion_tokens)
                span.set_attribute("gen_ai.usage.total_tokens", total_tokens)
            model_name = (response.llm_output or {}).get("model_name") or ""
            if model_name:
                span.set_attribute("gen_ai.response.model", model_name)
            # Capture completion text
            try:
                gens = response.generations
                if gens and gens[0]:
                    g = gens[0][0]
                    text = getattr(g, "text", None) or ""
                    if not text:
                        msg = getattr(g, "message", None)
                        if msg:
                            text = getattr(msg, "content", None) or ""
                    if isinstance(text, str) and text:
                        span.set_attribute("llm.completion", text[:4096])
            except Exception:
                pass
            span.set_status(StatusCode.OK)
        finally:
            span.end()
            context.detach(token)

    def on_llm_error(self, error: Exception, *, run_id: UUID, **kwargs: Any) -> None:
        key = str(run_id)
        if key not in self._llm_spans:
            return
        span, token = self._llm_spans.pop(key)
        try:
            span.set_status(StatusCode.ERROR, str(error))
            span.record_exception(error)
        finally:
            span.end()
            context.detach(token)

    # ── Tool ─────────────────────────────────────────────────────────────────

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        tool_name = (serialized or {}).get("name") or "tool"
        span = self._tracer.start_span(
            tool_name,
            kind=SpanKind.INTERNAL,
            attributes={
                "remi.span_type": "tool",
                "tool.name": tool_name,
                "tool.input": input_str[:512],
            },
        )
        # Expand JSON tool inputs into individual attributes for filtering
        try:
            parsed = json.loads(input_str)
            if isinstance(parsed, dict):
                for k, v in parsed.items():
                    span.set_attribute(f"tool.arg.{k}", str(v)[:256])
        except Exception:
            pass
        ctx = trace.set_span_in_context(span)
        token = context.attach(ctx)
        self._tool_spans[str(run_id)] = (span, token)

    def on_tool_end(self, output: Any, *, run_id: UUID, **kwargs: Any) -> None:
        key = str(run_id)
        if key not in self._tool_spans:
            return
        span, token = self._tool_spans.pop(key)
        try:
            span.set_attribute("tool.output", str(output)[:512])
            span.set_status(StatusCode.OK)
        finally:
            span.end()
            context.detach(token)

    def on_tool_error(self, error: Exception, *, run_id: UUID, **kwargs: Any) -> None:
        key = str(run_id)
        if key not in self._tool_spans:
            return
        span, token = self._tool_spans.pop(key)
        try:
            span.set_status(StatusCode.ERROR, str(error))
            span.record_exception(error)
        finally:
            span.end()
            context.detach(token)

    # ── Chain ────────────────────────────────────────────────────────────────

    def on_chain_start(
        self,
        serialized: dict[str, Any] | None,
        inputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        # Only create spans for top-level chains (no parent) to avoid noise
        if parent_run_id is not None:
            return
        ids = (serialized or {}).get("id") or []
        name = ids[-1] if ids else "Chain"
        span = self._tracer.start_span(
            name,
            kind=SpanKind.INTERNAL,
            attributes={"remi.span_type": "chain"},
        )
        ctx = trace.set_span_in_context(span)
        token = context.attach(ctx)
        self._chain_spans[str(run_id)] = (span, token)

    def on_chain_end(self, outputs: Any, *, run_id: UUID, **kwargs: Any) -> None:
        key = str(run_id)
        if key not in self._chain_spans:
            return
        span, token = self._chain_spans.pop(key)
        try:
            # Capture the final output of the top-level chain for eval purposes.
            # outputs may be a plain string (LCEL StrOutputParser) or a dict.
            try:
                if isinstance(outputs, str):
                    output_text: str | None = outputs
                elif isinstance(outputs, dict):
                    output_text = (
                        outputs.get("output")
                        or outputs.get("answer")
                        or outputs.get("result")
                        or outputs.get("text")
                    )
                    if not isinstance(output_text, str):
                        first = next(iter(outputs.values()), None)
                        output_text = first if isinstance(first, str) else None
                else:
                    output_text = str(outputs) if outputs else None
                if output_text:
                    span.set_attribute("remi.final_output", output_text[:8192])
            except Exception:
                pass
            span.set_status(StatusCode.OK)
        finally:
            span.end()
            context.detach(token)

    def on_chain_error(self, error: Exception, *, run_id: UUID, **kwargs: Any) -> None:
        key = str(run_id)
        if key not in self._chain_spans:
            return
        span, token = self._chain_spans.pop(key)
        try:
            span.set_status(StatusCode.ERROR, str(error))
            span.record_exception(error)
        finally:
            span.end()
            context.detach(token)


def _infer_provider(model: str) -> str:
    m = model.lower()
    if "gpt" in m or "o1" in m or "o3" in m:
        return "openai"
    if "claude" in m:
        return "anthropic"
    if "gemini" in m:
        return "google"
    if "mistral" in m:
        return "mistral"
    if "llama" in m or "meta" in m:
        return "meta"
    return "unknown"


def _parse_headers(raw: str | None) -> dict[str, str] | None:
    if not raw:
        return None
    headers: dict[str, str] = {}
    for part in raw.split(","):
        item = part.strip()
        if not item or "=" not in item:
            continue
        key, value = item.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key:
            headers[key] = value
    return headers or None


def _normalize_traces_endpoint(raw_endpoint: str) -> str:
    endpoint = raw_endpoint.rstrip("/")
    if endpoint.endswith("/v1/traces"):
        return endpoint
    return f"{endpoint}/v1/traces"


def configure_otel(
    service_name: str,
    org_id: str | None = None,
    service_version: str | None = None,
) -> tuple[TracerProvider, trace.Tracer]:
    """Initialize OTel TracerProvider. Safe to call multiple times — only configures once.

    Args:
        service_name: Used as service.name resource attribute (also the agent id).
        org_id: Used as service.namespace resource attribute.
        service_version: Set service.version to track prompt/code versions in AnalyticsPage.
                         Can also be set via OTEL_SERVICE_VERSION env var.
    """
    global _CONFIGURED

    if not _CONFIGURED:
        raw_endpoint = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") or os.getenv(
            "OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"
        )
        traces_endpoint = _normalize_traces_endpoint(raw_endpoint)
        headers = _parse_headers(os.getenv("OTEL_EXPORTER_OTLP_HEADERS"))

        effective_org_id = org_id or os.getenv("REMI_ORG_ID") or "default-org"
        effective_version = (
            service_version
            or os.getenv("OTEL_SERVICE_VERSION")
            or os.getenv("REMI_AGENT_VERSION")
        )

        resource_attrs: dict[str, str] = {
            "service.name": service_name,
            "service.namespace": effective_org_id,
        }
        if effective_version:
            resource_attrs["service.version"] = effective_version

        resource = Resource.create(resource_attrs)

        provider = TracerProvider(resource=resource)
        provider.add_span_processor(_MetadataSpanProcessor())
        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(endpoint=traces_endpoint, headers=headers)
            )
        )

        trace.set_tracer_provider(provider)
        _CONFIGURED = True
    else:
        provider = trace.get_tracer_provider()  # type: ignore[assignment]

    return provider, trace.get_tracer(service_name)


def make_callback(tracer: trace.Tracer) -> RemiCallback:
    """Create a fresh RemiCallback for each agent invocation."""
    return RemiCallback(tracer)
