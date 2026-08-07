# Remi

**Audit-grade observability for LLM agents.** Remi ingests OpenTelemetry traces
from LangChain, LangGraph, Claude Code, or any OTLP source, and turns them into
flame-chart timelines, prompt-level audit trails, system metrics, and
LLM-as-judge verdicts — org-scoped, self-hosted, on ClickHouse.

## First trace in five minutes

```bash
# 1. Start the stack (ClickHouse, Postgres, collector, backend, dashboard)
git clone https://github.com/SA4DRAO/remi-observability.git && cd remi-observability
docker compose up -d --build

# 2. Point ANY OpenTelemetry SDK at Remi — zero code, env vars only
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3100"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer acme-ingest-key"
export OTEL_EXPERIMENTAL_RESOURCE_DETECTORS="os,process,host"

# 3. Launch via the zero-code auto-instrumentation wrapper — no LangchainInstrumentor()
#    call, no custom TracerProvider. Every LLM call, tool, and graph step gets
#    traced with prompts, responses, and token usage automatically:
#    pip install opentelemetry-distro opentelemetry-instrumentation-langchain
#    opentelemetry-instrument python your_agent.py

# Open http://localhost:3000 — your sessions are there.
```

Or run a ready-made agent: `cd examples && source venv/bin/activate && OTEL_SERVICE_NAME=support-agent opentelemetry-instrument python customer_support_agent.py`
(needs `OPENROUTER_API_KEY` or `OPENAI_API_KEY` in the root `.env`; full env var list in `examples/README.md`).

## What you get

- **Flame-chart timelines** — every LLM call, tool execution, and chain step with exact timings
- **Prompt-level audit** — prompts/responses captured on spans, gated behind the `read:prompts` scope, every read logged to a **tamper-evident hash-chained audit log** (`GET /api/v1/admin/audit-log/verify` proves it wasn't altered)
- **LLM-as-a-judge** — one click scores any span for correctness, instruction adherence, tool-use quality, and hallucination risk; verdicts persist for regression comparison
- **Version comparison** — stamp `service.version` (or `REMI_AGENT_VERSION`) and compare latency, error rate, and judge scores across releases
- **System metrics** — CPU/memory of the agent process charted per session; host/OS/runtime from standard SDK resource detectors
- **Org isolation** — per-org API keys at ingest; the collector stamps `remi.org_id` from the validated key; every query is org-scoped server-side
- **PII redaction** — at the collector, before data touches storage

## Architecture

```
Agent (any OTel SDK) ──OTLP/protobuf + Bearer key──▶ Spring backend :3100
                                                        │ validates key, stamps X-Remi-Org
                                                        ▼
                                              OTel Collector :4318 (loopback only)
                                                        │ org stamp, PII redaction
                                                        ▼
                                          ClickHouse (spans, metrics) + Jaeger
                                                        ▲
                          Dashboard :3000 ──▶ Spring :3100 /api/v1/* (org from key)

                          Postgres = identity only (orgs, hashed keys, audit chain)
```

| Directory | What it is |
|-----------|------------|
| `remi-backend-spring/` | Spring Boot backend: org-scoped read API, authenticated OTLP ingest proxy, admin, judge |
| `remi/remi/` | React 19 dashboard |
| `examples/` | Production-style LangChain/LangGraph agents + the demo feeder |
| `remi-marketing/` | Marketing site |
| `remi-backend/` | Legacy Express backend — superseded, do not extend |

## Services & ports

| Service | Port | Notes |
|---------|------|-------|
| Dashboard | 3000 | `?key=<api-key>` overrides the baked-in key |
| Backend API + ingest | 3100 | `POST /v1/{traces,metrics,logs}` with org key |
| Marketing site | 3200 | |
| OTel Collector | 4318 | **loopback only** — external ingest goes through :3100 |
| ClickHouse | 8123 | |
| Jaeger UI | 16686 | |

## Seeded dev identities

| Org | Key | Scopes |
|-----|-----|--------|
| `acme` | `acme-ingest-key` | write:sessions (agents) |
| `acme` | `acme-admin-key` | all (dashboard default) |
| `demo-org` | `demo-view-key` | read-only (public live demo) |
| `demo-org` | `demo-ingest-key` | write:sessions (demo feeder) |
| `demo-org` | `test-key-123` | all (dev) |

Rotate all of these outside local dev. Postgres init scripts only run on a fresh
volume — apply seed changes to an existing DB via
`docker exec -i postgres-primary psql -U remi_user -d remi_db`.

## Benchmarks

`scripts/benchmark.sh` loads synthetic spans into an isolated `bench` org and
times the real dashboard queries against them. Results on a single dev box are
in the script header. Bench data lives in its own date partitions and is
dropped with one `ALTER TABLE ... DROP PARTITION` per day.

## Development

```bash
# Backend (builds inside the container image)
docker compose build backend

# Frontend
cd remi/remi && bun install && bun run dev   # type-check: bun run type-check

# Examples
cd examples && source venv/bin/activate && pip install -r requirements.txt
```

`VITE_*` vars are baked into the frontend bundle at build time (compose build
args). The judge needs `OPENROUTER_API_KEY` (or `OPENAI_API_KEY`) in the root
`.env`; the same key powers the example agents and the demo feeder.
