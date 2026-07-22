# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Setup

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

export OPENAI_API_KEY=sk-...        # ChatOpenAI reads this itself
# OpenRouter (or any OpenAI-compatible gateway) instead:
#   OPENAI_API_KEY=<openrouter key>
#   OPENAI_BASE_URL=https://openrouter.ai/api/v1
#   OPENAI_MODEL=openai/gpt-4o-mini
```

The full infra stack must be running (`docker compose up -d` from the repo root).

## The design rule: agents are fully isolated files

**There is zero observability code in any agent.** No Remi imports, no OTel
imports, no tracer, no flush, no session helper — `otel_setup.py` is gone.
Everything observability lives in exactly two standard places:

1. **The launcher** — `opentelemetry-instrument` (from `opentelemetry-distro`)
   builds the TracerProvider/exporter from `OTEL_*` env vars and auto-discovers
   `LangchainInstrumentor` + `SystemMetricsInstrumentor` via entry points.
   Spans flush via the SDK's atexit hook; no explicit flush call is needed.
2. **LangChain's own config** — session identity is the `thread_id` production
   LangGraph apps already pass for checkpointing:
   ```python
   agent.invoke(inputs, config={"configurable": {"thread_id": session_id}})
   ```
   The instrumentation maps it to `gen_ai.conversation.id` on the root span and
   `traceloop.association.properties.thread_id` on every child span; Remi's
   ClickHouse `SessionId` column resolves both (plus `metadata.session_id` for
   plain-LCEL users) to one session. Reuse a thread_id across invokes for
   multi-turn sessions — verified: a LangGraph invoke + a separate LCEL invoke
   sharing one thread_id land in ONE Remi session.

Session **completion** is also zero-code: spans only export after they end, so
the backend marks a session complete as soon as its root span (empty
ParentSpanId) arrives — no end marker, no 2-minute idle wait. (The idle cutoff
remains as fallback; an explicit `remi.session.end` span name is honored for
root-less streaming sources.)

## Running

```bash
export OTEL_TRACES_EXPORTER=otlp OTEL_METRICS_EXPORTER=otlp OTEL_LOGS_EXPORTER=none
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3100
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer acme-ingest-key"
export OTEL_RESOURCE_ATTRIBUTES="service.namespace=acme,service.version=1.0.0"
export OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=os,process,host
export OTEL_METRIC_EXPORT_INTERVAL=5000

OTEL_SERVICE_NAME=support-agent       opentelemetry-instrument python customer_support_agent.py
OTEL_SERVICE_NAME=research-agent      opentelemetry-instrument python research_agent.py
OTEL_SERVICE_NAME=simple-chain-agent  opentelemetry-instrument python simple_chain_agent.py
OTEL_SERVICE_NAME=code-review-agent   opentelemetry-instrument python code_review_agent.py
OTEL_SERVICE_NAME=supervisor-agent    opentelemetry-instrument python multi_agent_supervisor.py
OTEL_SERVICE_NAME=metrics-probe-agent opentelemetry-instrument python metrics_probe_agent.py
```

`tool_failure.py` is a helper module (injects intermittent tool failures), not a
runnable agent. `demo_feeder.sh` + `Dockerfile` wrap all of this for the compose
`demo-feeder` service, including the OpenRouter→OPENAI_* env translation.

## Gotchas

- **`opentelemetry-distro` is not optional.** Without it the launcher silently
  no-ops: instrumentors load, no exporter is built, zero spans leave, no error.
  If agents run but nothing appears: `pip show opentelemetry-distro`.
- **requirements.txt is pinned exactly, on purpose.** Auto-instrumentation is
  sensitive to the langchain/langgraph/instrumentor version combination — an
  open floor once resolved a combo that produced zero LangChain spans silently.
  Bump deliberately and re-verify against ClickHouse span/llm_call counts, not
  "the script didn't crash".
- **`OTEL_SERVICE_NAME` is the agent id** in the dashboard; without it sessions
  land under `unknown_service`.
- A one-time `create_agent` root span fires before any thread_id exists and
  shows up as its own tiny hex-named session — known artifact, harmless.
- Agents never health-check the telemetry endpoint: observability must not gate
  business logic. LLM clients set `timeout=60, max_retries=2`.
