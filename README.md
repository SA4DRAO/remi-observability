# Remi

**Audit-grade observability for LLM agents.** Point any OpenTelemetry source at
Remi — LangChain, LangGraph, or your own code — and get flame-chart timelines,
prompt-level audit trails, per-release regression comparison, and LLM-as-judge
verdicts. Self-hosted, org-scoped, on ClickHouse.

> **Trying Remi out?** Everything below is a fresh-clone path. If anything takes
> more than 10 minutes or doesn't behave as written, that's a bug — please tell
> us. See [Giving feedback](#giving-feedback).

---

## 1. Requirements

- Docker + Docker Compose (the only hard requirement)
- ~4 GB free RAM
- Optional: an `OPENROUTER_API_KEY` or `OPENAI_API_KEY` — needed **only** for the
  LLM-as-judge feature and for running the bundled example agents. Remi ingests
  and displays traces perfectly well without one.

## 2. Start the stack

```bash
git clone https://github.com/SA4DRAO/remi-observability.git
cd remi-observability

cp .env.example .env          # optional: add an LLM key for judge + examples
docker compose up -d --build  # first build takes a few minutes
```

Then open **<http://localhost:3000>**.

Check everything is alive:

```bash
curl http://localhost:3100/api/v1/health     # {"status":"ok",...}
docker compose ps                            # all services Up
```

> **Heads-up on cost:** the `demo-feeder` service continuously runs example
> agents against a demo org so the dashboard isn't empty on first load. It uses
> **your** LLM key. Turn it off with `docker compose stop demo-feeder` — the rest
> of the stack is unaffected.

## 3. Send your own agent's traces

This is the part worth evaluating. **You do not write any telemetry code** — no
SDK import, no callback handler, no `TracerProvider`. Instrumentation is env vars
plus a launcher.

```bash
pip install opentelemetry-distro opentelemetry-instrumentation-langchain
opentelemetry-bootstrap -a install

export OTEL_SERVICE_NAME="my-agent"                  # shows up as the agent name
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3100"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer acme-ingest-key"
export OTEL_EXPERIMENTAL_RESOURCE_DETECTORS="os,process,host"
export OTEL_RESOURCE_ATTRIBUTES="service.version=1.0.0"   # enables the Versions page

opentelemetry-instrument python your_agent.py
```

Reload <http://localhost:3000> — your session is there, with every LLM call, tool
execution, and graph step timed and captured.

**To group multi-step runs into one session**, pass a thread id — this is the
only line that touches your agent code, and it's optional:

```python
agent.invoke({"messages": [...]}, config={"configurable": {"thread_id": "run-123"}})
```

Without it, each trace is its own session.

### No traces showing up?

| Symptom | Cause |
|---|---|
| `401` from the exporter | Wrong/missing bearer key. Use `acme-ingest-key`. |
| Connection refused on `:4318` | Expected — the collector is loopback-only by design. Always export to the backend proxy on **`:3100`**. |
| Agent runs but nothing appears | You ran `python agent.py` instead of `opentelemetry-instrument python agent.py`. |
| Spans appear, session says "running" | Normal until the root span closes; multi-turn threads read complete between turns. |

## 4. What to look at

| Page | What it shows |
|---|---|
| **Sessions** | Every run. Click one for the flame chart, span tree, step-through replay, prompts/responses, and CPU/memory of the agent process. |
| **Analytics** | Cross-session rollups — volume, latency, tokens, per-model and per-agent breakdowns. |
| **Versions** | Per-release regression view. Set `service.version`, pick a baseline, and see latency/error/token/CPU deltas between releases of the *same* agent. "Judge 3" scores a random sample so quality columns fill in. |
| **⌘K / Ctrl-K** | Full-text search across span names, models, **and prompt/completion bodies**. |
| **Judge** | On any LLM span: scores correctness, instruction adherence, tool-use quality, and hallucination risk. Needs an LLM key. |

Also running: Jaeger at <http://localhost:16686> if you want raw trace inspection.

## 5. Access control

Remi is org-scoped: **every query is filtered by the org resolved from the API
key server-side.** Client-supplied org parameters are ignored.

Prompt and completion bodies are gated behind the `read:prompts` scope — keys
without it get redacted attributes, and Cmd-K will not match prompt text for
them. Every prompt read is written to a **hash-chained audit log**; verify it
hasn't been tampered with:

```bash
curl -H "Authorization: Bearer acme-admin-key" \
     http://localhost:3100/api/v1/admin/audit-log/verify
```

Seeded keys for local evaluation — **rotate these before any real use**:

| Org | Key | Scopes |
|-----|-----|--------|
| `acme` | `acme-admin-key` | everything (dashboard default) |
| `acme` | `acme-ingest-key` | `write:sessions` (point your agents here) |
| `demo-org` | `demo-view-key` | read-only, includes prompts |
| `demo-org` | `demo-ingest-key` | `write:sessions` (demo feeder) |

The dashboard accepts `?key=<api-key>` to switch keys without a rebuild — handy
for seeing exactly what a restricted key can and can't read.

## 6. Try the bundled examples

Five production-shaped LangChain/LangGraph agents (support, research, code
review, supervisor, simple chain). Requires an LLM key in `.env`.

```bash
cd examples
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
OTEL_SERVICE_NAME=support-agent opentelemetry-instrument python customer_support_agent.py
```

These contain **zero telemetry code** — that's the point. Full env reference in
[`examples/CLAUDE.md`](examples/CLAUDE.md).

## Architecture

```
Your agent (any OTel SDK) ──OTLP + Bearer key──▶ Spring backend :3100
                                                    │ validates key, stamps org
                                                    ▼
                                        OTel Collector (loopback only)
                                                    │ PII redaction, normalization
                                                    ▼
                                        ClickHouse (spans + metrics)
                                                    ▲
                        Dashboard :3000 ──▶ backend /api/v1/* (org from key)

                        Postgres = identity only (orgs, hashed keys, audit chain)
```

| Directory | What it is |
|-----------|------------|
| `remi-backend-spring/` | The backend — Spring Boot: read API, authenticated ingest proxy, admin, judge |
| `remi/remi/` | React 19 dashboard |
| `examples/` | Example agents + demo feeder |
| `remi-marketing/` | Marketing site (`:3200`) |

**Ports:** dashboard `3000` · API + ingest `3100` · marketing `3200` · ClickHouse
`8123` · Jaeger `16686` · collector `4318` (loopback only).

## Known gaps

Being upfront, since you're evaluating:

- **Per-org PII policy is not enforced yet.** The admin API stores custom rules,
  but the collector applies a fixed built-in ruleset (SSN / credit card / email)
  to every org. Baseline redaction works; per-org customization does not.
- **No automated test suite.** Verification is against live ClickHouse counts.
- Admin surfaces (orgs, keys, audit log) are **API-only** — no UI yet.
- Judge verdicts are re-computed on demand rather than served from cache.

## Development

```bash
docker compose build backend                    # backend builds in-container
cd remi/remi && bun install && bun run dev      # frontend; bun run type-check
./scripts/benchmark.sh 100000                   # query perf on synthetic spans
```

Postgres and ClickHouse init scripts run **only on a fresh volume**. To reset:
`docker compose down -v && docker compose up -d --build`.

## Giving feedback

Most useful to us, roughly in order:

1. Where did onboarding stall? Anything in section 2 or 3 that didn't work verbatim.
2. Did the data match reality — are latency, token, and error numbers what you expected for your agent?
3. What did you look for and fail to find?
4. Would the Versions page change how you ship agent releases?

Open an issue at <https://github.com/SA4DRAO/remi-observability/issues> or reply
on the thread. Logs help: `docker compose logs backend --tail 100`.
