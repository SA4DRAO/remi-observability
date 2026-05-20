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
# Each script has its own default org/agent_id — no override needed
```

The full infra stack must be running (`docker-compose up -d` from the repo root) before running examples.

## Running Examples

```bash
python simple_chain_agent.py       # simplest: two-step LCEL pipeline
python research_agent.py           # ReAct agent with tools
python customer_support_agent.py   # multi-turn conversation
python code_review_agent.py        # tool-heavy StateGraph agent
python multi_agent_supervisor.py   # two-agent pipeline (analyst + writer)
```

## How Examples Instrument Remi

All examples use **pure OTLP emission** via `otel_setup.py` + `LangchainInstrumentor`:

1. `configure_otel(AGENT_ID, org_id=ORG_ID)` — creates an OTLP `TracerProvider` pointed at `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`). Sets `service.name` = agent ID and `service.namespace` = org ID as resource attributes. Attaches `_MetadataSpanProcessor` which stamps `remi.session_id` and `gen_ai.conversation.id` on every span from ContextVars.
2. `LangchainInstrumentor().instrument()` — auto-instruments all LangChain/LangGraph calls (LLM calls, tool calls, chains) as child OTel spans with `gen_ai.*` attributes and token usage. No custom callback needed.
3. `set_session_id(session_id)` — sets the session ContextVar before each invocation so the span processor can stamp it on all spans in that invocation.

Each example follows this pattern:
```python
tracer_provider, tracer = configure_otel(AGENT_ID, org_id=ORG_ID)
LangchainInstrumentor().instrument()
# ...
set_session_id(session_id)          # before each invocation
with tracer.start_as_current_span("AgentExecutor", attributes={"remi.session_id": session_id}):
    agent.invoke(inputs)            # no callbacks needed
```

Sessions are auto-created by the V2 OTLP ingest path — no explicit `POST /api/v1/sessions` needed.

The OTel collector receives spans and forwards them to the backend at `POST /api/v1/traces/v1/traces`.

## Architecture Notes

- `otel_setup.py` is **not a package** — examples import it directly. Run from the `examples/` directory.
- `_CONFIGURED` global prevents double-initialization of the TracerProvider.
- `tracer_provider.shutdown()` at the end of each script flushes the `BatchSpanProcessor` and ensures all spans export before exit.
- `simple_chain_agent.py` uses `set_conversation_id()` to group multiple sessions under one conversation in the Remi UI.
- Model names default to `gpt-4o-mini` via `OPENAI_MODEL`. Swap `OPENAI_BASE_URL` and `OPENAI_MODEL` env vars to use a different provider or model.
