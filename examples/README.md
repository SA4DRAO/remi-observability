# examples

Python demo scripts that run LangChain/LangGraph agents against a live Remi stack and show up as sessions in the dashboard.

---

## What it does

Each script is a **fully isolated** LangChain/LangGraph agent — zero telemetry
code of any kind: no Remi imports, no OTel imports, no tracer, no flush. Tracing
is bootstrapped entirely by
[`opentelemetry-instrument`](https://opentelemetry-python-contrib.readthedocs.io/en/latest/examples/auto-instrumentation/)
(zero-code auto-instrumentation) plus `OTEL_*` env vars. Spans go via OTLP HTTP
straight to the backend's authenticated ingest proxy (`:3100`), which validates
the org key, forwards to the internal collector, and sessions appear in the
dashboard within seconds.

Session identity is LangChain's own `thread_id` — the key production LangGraph
apps already pass for checkpointing:

```python
agent.invoke(inputs, config={"configurable": {"thread_id": session_id}})
```

The instrumentation maps it to the standard `gen_ai.conversation.id` attribute,
which Remi groups sessions by. Reuse a thread_id across invokes (even mixing
LangGraph agents and plain LCEL chains) and they land in one session. Sessions
complete the moment the invocation's root span lands — no idle wait, no
end-of-session call.

---

## Prerequisites

| Tool     | Version |
|----------|---------|
| Python   | >= 3.9  |

The full infra stack must be running before executing any example:

```bash
# from repo root
docker compose up -d
```

---

## Setup

```bash
cd examples
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt   # includes opentelemetry-distro — required, see below
```

Create a `.env` file in `examples/` (or `cp ../.env .env`):

```bash
OPENAI_API_KEY=sk-...              # or OPENROUTER_API_KEY, preferred
```

---

## Running examples

Bootstrap is env-var driven. Set the shared block once per shell session:

```bash
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=none
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3100
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer acme-ingest-key"
export OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=os,process,host
export OTEL_RESOURCE_ATTRIBUTES="service.namespace=acme"
```

Then launch each script via `opentelemetry-instrument`, with `OTEL_SERVICE_NAME`
set to that script's agent id (it must match — see table below):

```bash
OTEL_SERVICE_NAME=simple-chain-agent  opentelemetry-instrument python simple_chain_agent.py
OTEL_SERVICE_NAME=research-agent      opentelemetry-instrument python research_agent.py
OTEL_SERVICE_NAME=support-agent       opentelemetry-instrument python customer_support_agent.py
OTEL_SERVICE_NAME=code-review-agent   opentelemetry-instrument python code_review_agent.py
OTEL_SERVICE_NAME=supervisor-agent    opentelemetry-instrument python multi_agent_supervisor.py
OTEL_SERVICE_NAME=metrics-probe-agent opentelemetry-instrument python metrics_probe_agent.py
```

Running `python script.py` directly (no `opentelemetry-instrument`) still works —
the agent just runs untraced, because the agent files contain no telemetry code
at all.

After a script exits, open the dashboard at `http://localhost:3000`. Each agent's
`OTEL_SERVICE_NAME` is visible in the dashboard's agent filter.

> `tool_failure.py` is a helper module (injects intermittent tool failures for
> error-path demos), not a runnable agent.

---

## Environment variables

| Variable                          | Purpose                                                              |
|------------------------------------|-----------------------------------------------------------------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT`      | Backend's authenticated ingest proxy (`http://localhost:3100`)       |
| `OTEL_EXPORTER_OTLP_HEADERS`       | `Authorization=Bearer <org ingest key>`                              |
| `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS` | `os,process,host` — standard SDK detectors, no custom code       |
| `OTEL_RESOURCE_ATTRIBUTES`         | `service.namespace=<org>` (and optionally `service.version=<X>` for the version-comparison view) |
| `OTEL_SERVICE_NAME`                | Per-script agent id — **must** match the table above                 |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | LLM provider key; OpenRouter preferred when set                 |

`opentelemetry-instrument` requires the `opentelemetry-distro` package. Without it
the CLI runs but silently no-ops — instrumentors get discovered, but no working
`TracerProvider`/exporter ever gets built, so nothing errors and nothing exports.
If agents run cleanly but nothing shows up in the dashboard, `pip show opentelemetry-distro`.

---

## How instrumentation works

The agent file contains ONE observability-relevant line, and it's standard
LangChain, not telemetry:

```python
session_id = f"support-{uuid.uuid4().hex[:8]}"
agent.invoke(inputs, config={"configurable": {"thread_id": session_id}})
```

Everything else is the launcher: `opentelemetry-instrument` builds the
TracerProvider + OTLP exporter from env vars, auto-discovers the LangChain and
system-metrics instrumentors via entry points, and flushes spans at process
exit via the SDK's atexit hook. `OTEL_SERVICE_NAME` sets `service.name`
(agent id); `OTEL_RESOURCE_ATTRIBUTES` sets `service.namespace` (org) and
`service.version` (release, for the version-comparison view). Sessions are
created automatically by the OTLP ingest path and complete when the root span
arrives.

---

## How it connects to other components

```
examples/ (opentelemetry-instrument)
        │ OTLP HTTP spans, Authorization: Bearer <ingest key>
        ▼
Spring backend :3100  (validates key, forwards + stamps X-Remi-Org)
        │
        ▼
OTel Collector :4318 (loopback only)
        │ stamps remi.org_id, redacts PII
        ▼
ClickHouse + Jaeger
        ▲
remi (dashboard) reads via :3100 /api/v1/*
```
