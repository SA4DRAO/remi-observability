# Remi Observability

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](remi-backend/)
[![Python](https://img.shields.io/badge/Python-3.9+-yellow)](remi-worker/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](remi/remi/)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-native-f5a800)](https://opentelemetry.io/)

Remi is an open-source observability platform for LLM agents. It collects, processes, and visualizes traces from LangChain, LangGraph, and any OpenTelemetry-instrumented application — giving you a real-time view of every LLM call, token cost, and error across your entire agent pipeline.

Remi is built with:

[![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white)](remi-backend/)
[![React](https://img.shields.io/badge/-React-61DAFB?logo=react&logoColor=black)](remi/remi/)
[![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)](remi-worker/)
[![Kafka](https://img.shields.io/badge/-Kafka-231F20?logo=apachekafka&logoColor=white)](docker-compose.yml)
[![PostgreSQL](https://img.shields.io/badge/-PostgreSQL-4169E1?logo=postgresql&logoColor=white)](scripts/init-db.sql)
[![Redis](https://img.shields.io/badge/-Redis-DC382D?logo=redis&logoColor=white)](docker-compose.yml)

---

## Index

- [Features](#features)
- [Architecture](#architecture)
- [Services & Ports](#services--ports)
- [Quick Start](#quick-start)
- [Running Example Agents](#running-example-agents)
- [Development Environment](#development-environment)
- [Tech Stack](#tech-stack)

---

## Features

- **Full trace timeline** — Every LLM call, tool invocation, and chain step visualized as a flame chart with precise timings
- **Token usage & cost tracking** — Input/output tokens and USD cost per span, per session, and aggregated across your entire fleet
- **Cross-session analytics** — Error rates, model breakdown, version comparison — all queryable by org, agent, and date range
- **LLM-as-a-judge span analysis** — Select any span in the trace and ask an LLM to evaluate it (latency, quality, cost efficiency)
- **OpenTelemetry native** — Works with any OTel-compatible source out of the box; no proprietary SDK required
- **LangChain / LangGraph support** — Drop-in `RemiCallback` emits properly structured spans without any third-party instrumentation package
- **OpenRouter webhook support** — Forward production traces directly from OpenRouter into Remi
- **Version comparison** — Tag your agents with `service.version` and compare token usage, cost, and error rate across releases
- **Model pricing sync** — Pulls current pricing from LiteLLM's community-maintained dataset; cost calculations stay accurate

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  LangChain / LangGraph / any OTLP source        │
│  examples/otel_setup.py · RemiCallback          │
└──────────────────────┬──────────────────────────┘
                       │ OTLP HTTP spans
                       ▼
              ┌────────────────┐
              │ OTel Collector │ :4318
              └───────┬────────┘
                      │ POST /api/v1/traces
                      ▼
              ┌────────────────┐
              │  remi-backend  │ :3100  Express 5 / TypeScript / Bun
              │  · Zod schema  │
              │  · Kafka prod. │
              │  · Redis cache │
              └──┬─────────────┘
                 │ Kafka topic: remi-events
                 ▼
         ┌──────────────┐
         │  remi-worker │      Python asyncio / AIOKafkaConsumer
         │  · batch     │
         │  · dedup     │
         │  · metrics   │
         └──────┬───────┘
                │ asyncpg
                ▼
          ┌──────────┐
          │ Postgres │ :5432
          └──────────┘
                ▲
                │ REST API
         ┌──────────────┐
         │  remi (UI)   │ :3000  React 19 / Vite / TanStack Query
         └──────────────┘
```

---

## Services & Ports

| Service         | Host port | Purpose                          |
|-----------------|-----------|----------------------------------|
| Dashboard UI    | 3000      | Observability frontend           |
| Backend API     | 3100      | REST API + OTLP ingest           |
| Postgres        | 5432      | Session and trace storage        |
| Kafka           | 9092      | Event streaming (KRaft, no ZK)   |
| Redis           | 6379      | Cache layer                      |
| Jaeger UI       | 16686     | Distributed trace viewer         |
| OTel Collector  | 4318      | OTLP HTTP receiver               |

---

## Quick Start

**Prerequisites:** Docker or Podman with Compose support (no other dependencies needed)

```bash
# 1. Clone
git clone https://github.com/SA4DRAO/remi-observability.git
cd remi-observability

# 2. Configure environment
cp .env.example .env
# Open .env and set your OpenAI API key — that's the only required change:
#   OPENAI_API_KEY=sk-...

# 3. Start all services
#    First run builds images and initialises the database (~2 minutes)
docker-compose up -d
# or: podman-compose up -d

# 4. Wait for services to be healthy (~60 seconds for Kafka)
docker-compose ps

# 5. Verify the backend is up
curl http://localhost:3100/health

# 6. Open the dashboard
#    http://localhost:3000
```

> **Podman users:** `podman-compose` works as a drop-in replacement everywhere `docker-compose` is used below.

> **Fresh database:** The Postgres container runs `scripts/init-db.sql` automatically on first start — no manual migration step needed.

---

## Environment Variables

### Root `.env` (stack config)

Copy `.env.example` to `.env`. The only required variable is:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | **Yes** | — | Powers the LLM-as-a-judge span analysis feature and the example agents |
| `REMI_API_KEY` | No | `test-key-123` | Bearer token used by all services to authenticate requests |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | Swap for any OpenAI-compatible endpoint (Anthropic, local Ollama, etc.) |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model used for span analysis and example agents |

> The dashboard frontend reads `REMI_API_KEY` as `VITE_API_KEY` — both are set automatically from the root `.env` via docker-compose.

### `examples/.env` (example agents)

The example agents read from their own `.env` inside `examples/`. Copy from root and add the Remi connection vars:

```bash
cp .env examples/.env   # copies OPENAI_API_KEY
# examples/.env already has the right defaults — no edits needed for a local stack:
#   REMI_API_KEY=test-key-123
#   REMI_BACKEND_URL=http://localhost:3100
#   OPENAI_BASE_URL=https://api.openai.com/v1
#   OPENAI_MODEL=gpt-4o-mini
```

Or create `examples/.env` manually:

```bash
OPENAI_API_KEY=sk-...          # your key
REMI_API_KEY=test-key-123      # must match REMI_API_KEY in root .env
REMI_BACKEND_URL=http://localhost:3100
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

---

## Running Example Agents

The `examples/` directory contains runnable LangChain agents that send traces through the full Remi pipeline. After each run, refresh the dashboard to see the new session.

```bash
cd examples

# First-time setup
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Configure (see Environment Variables section above)
cp ../.env .env              # copies OPENAI_API_KEY from root
# Add the Remi connection vars if not already present:
echo 'REMI_API_KEY=test-key-123' >> .env
echo 'REMI_BACKEND_URL=http://localhost:3100' >> .env

# Run the examples (stack must be running)
python simple_chain_agent.py       # Two-step LCEL pipeline — good starting point
python research_agent.py           # ReAct agent with parallel tool calls
python customer_support_agent.py   # Customer support agent with ticket workflows
python code_review_agent.py        # Tool-heavy StateGraph code analysis agent
python multi_agent_supervisor.py   # Two-agent pipeline: analyst → writer
```

Sessions appear in the dashboard within a few seconds of each script exiting. Each agent has a distinct name (`simple-chain-agent`, `research-agent`, etc.) visible in the dashboard's agent filter.

---

## Development Environment

Each sub-package can be developed independently. All packages communicate over `localhost` when running outside Docker.

### Backend (`remi-backend/`)

```bash
cd remi-backend
bun install

bun run dev           # Watch mode
bun run type-check    # tsc --noEmit (strict mode)
bun run lint
bun test              # Runs test/*.test.js (builds first)
bun test test/validation.test.js   # Single file
```

### Frontend (`remi/remi/`)

```bash
cd remi/remi
bun install

bun run dev           # Vite dev server at http://localhost:5173 with HMR
bun run type-check
bun run lint
bun run build
```

### Worker (`remi-worker/`)

```bash
cd remi-worker
pip install -e ".[dev]"

python -m remi_worker  # Run directly
pytest                 # All tests
pytest tests/test_consumer.py   # Single file
mypy src/
```

### Useful Commands

```bash
# Tail logs for a specific service
docker-compose logs -f backend
docker-compose logs -f worker

# Rebuild a single service after a code change
docker-compose up -d --build backend

# Full reset (removes all data volumes)
docker-compose down -v

# Sync model pricing into the database
python scripts/sync-model-pricing.py
```

---

## Tech Stack

Remi would not be possible without these projects:

| Component | Project |
|-----------|---------|
| OTLP tracing | [OpenTelemetry](https://opentelemetry.io/) |
| LangChain integration | [LangChain](https://github.com/langchain-ai/langchain) |
| Kafka client (backend) | [KafkaJS](https://github.com/tulios/kafkajs) |
| Kafka client (worker) | [aiokafka](https://github.com/aio-libs/aiokafka) |
| Database client | [asyncpg](https://github.com/MagicStack/asyncpg) |
| UI components | [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://www.radix-ui.com/) |
| Data fetching | [TanStack Query](https://tanstack.com/query) |
| Schema validation | [Zod](https://zod.dev/) |
| Model pricing data | [LiteLLM](https://github.com/BerriAI/litellm) |
| Tracing UI | [Jaeger](https://www.jaegertracing.io/) |
| Runtime (backend) | [Bun](https://bun.sh/) |

Be sure to follow and support those projects too.
