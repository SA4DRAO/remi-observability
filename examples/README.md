# examples

Python demo scripts that run LangChain/LangGraph agents against a live Remi stack and show up as sessions in the dashboard.

---

## What it does

Each script runs an agent instrumented with `otel_setup.py` and `LangchainInstrumentor`. Spans are emitted via OTLP HTTP to the OTel Collector, which forwards them to remi-backend. Sessions appear in the dashboard within a few seconds of the script completing.

No proprietary SDK is required — instrumentation uses standard `opentelemetry-instrumentation-langchain`.

---

## Prerequisites

| Tool     | Version |
|----------|---------|
| Python   | >= 3.9  |

The full infra stack must be running before executing any example:

```bash
# from repo root
docker-compose up -d   # or: podman-compose up -d
```

---

## Setup

```bash
cd examples
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in `examples/`:

```bash
OPENAI_API_KEY=sk-...          # required
REMI_API_KEY=test-key-123      # must match REMI_API_KEY in root .env
REMI_BACKEND_URL=http://localhost:3100
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

Or copy from the root `.env`:

```bash
cp ../.env .env
echo 'REMI_API_KEY=test-key-123' >> .env
echo 'REMI_BACKEND_URL=http://localhost:3100' >> .env
```

---

## Running examples

```bash
python simple_chain_agent.py       # two-step LCEL pipeline (outline → expand)
python research_agent.py           # ReAct agent with parallel tool lookups
python customer_support_agent.py   # customer support agent with ticket workflows
python code_review_agent.py        # tool-heavy StateGraph code analysis agent
python multi_agent_supervisor.py   # two-agent pipeline: analyst → writer
python tool_failure.py             # deliberate tool error for error-path testing
```

After a script exits, open the dashboard at `http://localhost:3000`. Each agent uses a distinct name (`simple-chain-agent`, `research-agent`, etc.) visible in the dashboard's agent filter.

---

## Environment variables

| Variable                      | Default                       | Purpose                                                 |
|-------------------------------|-------------------------------|---------------------------------------------------------|
| `OPENAI_API_KEY`              | _(required)_                  | API key for the LLM provider                            |
| `REMI_API_KEY`                | `test-key-123`                | Must match the backend's `REMI_API_KEY`                 |
| `REMI_BACKEND_URL`            | `http://localhost:3100`       | Used for the health check before running                |
| `OPENAI_BASE_URL`             | `https://api.openai.com/v1`   | Swap for any OpenAI-compatible endpoint                 |
| `OPENAI_MODEL`                | `gpt-4o-mini`                 | Model name passed to `ChatOpenAI`                       |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318`       | OTLP HTTP endpoint (OTel Collector)                     |

Each agent has its own hardcoded `AGENT_ID` default (e.g. `research-agent`, `support-agent`). Override with `REMI_AGENT_ID` if needed.

---

## How instrumentation works

All examples follow this pattern:

```python
from opentelemetry.instrumentation.langchain import LangchainInstrumentor
from otel_setup import configure_otel, set_session_id

tracer_provider, tracer = configure_otel(AGENT_ID, org_id=ORG_ID)
LangchainInstrumentor().instrument()   # auto-instruments all LangChain/LangGraph calls

# Before each invocation:
set_session_id(session_id)
with tracer.start_as_current_span("AgentExecutor", attributes={"remi.session_id": session_id}):
    agent.invoke(inputs)   # no callbacks needed

# Flush spans before exit:
tracer_provider.shutdown()
```

`configure_otel` sets `service.name` = agent ID and `service.namespace` = org ID as OTel resource attributes, which the backend uses to populate `agent_id` and `org_id` in the dashboard.

Sessions are created automatically by the OTLP ingest path — no explicit session creation call needed.

---

## How it connects to other components

```
examples/
        │ OTLP HTTP spans (port 4318)
        ▼
OTel Collector
        │ POST /api/v1/traces
        ▼
remi-backend → Postgres
                    ▲
        remi (dashboard) reads
```
