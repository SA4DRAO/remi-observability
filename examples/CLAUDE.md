# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Setup

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Required env vars (copy from root .env.example)
export REMI_API_KEY=your_key
export REMI_BACKEND_URL=http://localhost:3100     # or http://otel-collector:4318 inside Docker
export OPENAI_API_KEY=your_openai_key             # or OPENAI_BASE_URL for non-OpenAI providers
export REMI_ORG_ID=demo-org
export REMI_AGENT_ID=demo-agent
```

The full infra stack must be running (`docker-compose up -d` from the repo root) before running examples.

## Running Examples

```bash
python simple_chain_agent.py       # simplest: two-step LCEL pipeline
python research_agent.py           # ReAct agent with tools
python customer_support_agent.py   # multi-turn conversation
python code_review_agent.py        # tool-heavy agent
python multi_agent_supervisor.py   # LangGraph supervisor + subagents
python tool_failure.py             # deliberate tool error for error-path testing
python verify_kafka_events.py      # confirms events reached Kafka (diagnostic)
```

## How Examples Instrument Remi

All examples use **direct OTLP emission** via `otel_setup.py`:

1. Creates an OTLP `TracerProvider` pointed at `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`)
2. Adds `_SessionIdSpanProcessor` **first** — stamps `remi.session_id` on every span from a `ContextVar` so spans emitted before the root span closes are still correlated
3. Provides `RemiCallback(BaseCallbackHandler)` — a LangChain callback that creates OTel child spans for LLM calls (with `gen_ai.*` attributes + token usage) and tool calls without requiring `opentelemetry-instrumentation-langchain`
4. Sets `service.name` = agent name and `service.namespace` = org_id as resource attributes

Each example calls:
```python
tracer_provider, tracer = configure_otel(AGENT_ID, org_id=ORG_ID)
set_session_id(session_id)          # before each invocation
cb = make_callback(tracer)          # fresh callback per invocation
agent.invoke(inputs, config={"callbacks": [cb]})
```

Sessions are auto-created by the V2 OTLP ingest path — no explicit `POST /api/v1/sessions` needed.

The OTel collector receives spans and forwards them to the backend at `POST /api/v1/traces/v1/traces`.

## Architecture Notes

- `otel_setup.py` is **not a package** — examples import it directly (`from otel_setup import configure_otel, make_callback, set_session_id`). Run from the `examples/` directory.
- `_CONFIGURED` global prevents double-initialization. Reset it manually in tests if needed.
- `tracer_provider.shutdown()` at the end of each script flushes the `BatchSpanProcessor` and ensures all spans export before exit.
- `RemiCallback` tracks active spans per `run_id` in plain dicts — not thread-safe. Use one callback instance per agent invocation (`make_callback(tracer)` each time).
- Model names default to `gpt-4o-mini` via `OPENAI_MODEL`. Swap `OPENAI_BASE_URL` and `OPENAI_MODEL` env vars to use a different provider or model.
