# examples

Python demo scripts that run LangChain agents against a live Remi stack and show up as sessions in the dashboard.

---

## What it does

Each script runs a LangChain agent (LCEL chain, ReAct agent, LangGraph supervisor, etc.) instrumented with `otel_setup.py`. Spans are emitted via OTLP HTTP to the OTel Collector, which forwards them to remi-backend. Sessions appear in the dashboard within a few seconds of the script completing.

No remi-specific SDK is required — instrumentation uses standard `opentelemetry-sdk` plus a thin `RemiCallback(BaseCallbackHandler)` defined in `otel_setup.py`.

---

## Prerequisites

| Tool     | Version              |
|----------|----------------------|
| Python   | >= 3.9               |
| pip      | any                  |

The full infra stack must be running before executing any example:

```bash
# from repo root
docker-compose up -d
```

---

## Setup

```bash
cd examples
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Copy your credentials into environment variables (or a `.env` file loaded by `python-dotenv`):

```bash
export REMI_API_KEY=your-api-key          # must match the backend's REMI_API_KEY
export OPENAI_API_KEY=your-llm-key        # required for all examples
export REMI_ORG_ID=demo-org               # org label shown in the dashboard
export REMI_AGENT_ID=demo-agent           # agent label shown in the dashboard

# Optional — override the LLM provider
# Default uses Google Gemini via their OpenAI-compatible endpoint:
export OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
export OPENAI_MODEL=gemini-2.0-flash

# OTel collector endpoint (default works with docker-compose)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

---

## Running examples

```bash
python simple_chain_agent.py        # two-step LCEL pipeline (outline → expand)
python research_agent.py            # ReAct agent with search tools
python customer_support_agent.py    # multi-turn conversation
python code_review_agent.py         # tool-heavy agent
python multi_agent_supervisor.py    # LangGraph supervisor + subagents
python tool_failure.py              # deliberate tool error for error-path testing
python verify_kafka_events.py       # confirms events reached Kafka (diagnostic)
```

After a script exits, open the dashboard at `http://localhost:3000` — sessions appear under the org/agent you configured.

---

## Environment variables

| Variable                          | Default                             | Purpose                                                 |
|-----------------------------------|-------------------------------------|---------------------------------------------------------|
| `REMI_API_KEY`                    | _(required)_                        | Must match the backend's `REMI_API_KEY`                 |
| `REMI_ORG_ID`                     | `demo-org`                          | Org label stamped on sessions                           |
| `REMI_AGENT_ID`                   | `demo-agent`                        | Agent label stamped on sessions                         |
| `REMI_BACKEND_URL`                | `http://localhost:3100`             | Used only for the optional health check before running  |
| `OPENAI_API_KEY`                  | _(required)_                        | API key for the LLM provider                            |
| `OPENAI_BASE_URL`                 | `https://api.openai.com/v1`         | Base URL — swap for Gemini/Anthropic/etc.               |
| `OPENAI_MODEL`                    | `gemini-2.0-flash`                  | Model name passed to `ChatOpenAI`                       |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | `http://localhost:4318`             | OTLP HTTP endpoint (collector or backend directly)      |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | _(falls back to OTLP_ENDPOINT)_ | Override for traces-specific endpoint                   |
| `OTEL_EXPORTER_OTLP_HEADERS`      | _(none)_                            | Comma-separated `key=value` headers for the exporter    |
| `OTEL_SERVICE_VERSION`            | _(none)_                            | Stamp spans with a prompt/code version string           |
| `REMI_AGENT_VERSION`              | _(none)_                            | Alternative to `OTEL_SERVICE_VERSION`                   |

---

## How instrumentation works

All examples import from `otel_setup.py` (not a package — run from the `examples/` directory):

```python
from otel_setup import configure_otel, make_callback, set_session_id

tracer_provider, tracer = configure_otel(AGENT_ID, org_id=ORG_ID)

# Call before each invocation
set_session_id(str(uuid.uuid4()))

# Fresh callback per invocation
cb = make_callback(tracer)
result = chain.invoke(inputs, config={"callbacks": [cb]})

# Flush all spans before the process exits
tracer_provider.shutdown()
```

`configure_otel` is safe to call multiple times — it only configures once (guarded by `_CONFIGURED`). `make_callback` must be called fresh for each invocation; `RemiCallback` is not thread-safe.

Sessions are created automatically by the V2 OTLP ingest path in remi-backend — no explicit session creation call is needed.

---

## How it connects to other components

```
examples/
        │ OTLP HTTP spans (port 4318)
        ▼
OTel Collector
        │ POST /api/v1/traces
        ▼
remi-backend → Kafka → remi-worker → Postgres
                                          ▲
                              remi (dashboard) reads
```
