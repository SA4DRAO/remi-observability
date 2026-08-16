# Remi

**Enterprise LLM observability without the SDK lock-in.**

Remi is an OpenTelemetry-native tracing engine for secure, self-hosted agent
platforms. Point any OTLP source at it — LangChain, LangGraph, or your own code —
and get flame-chart timelines, prompt-level audit trails, per-release regression
comparison, and LLM-as-judge verdicts. Runs entirely on your infrastructure, on
ClickHouse.

Three things make it different:

- **Zero-SDK ingest.** Your agent imports nothing from Remi. Instrumentation is
  `opentelemetry-instrument` plus environment variables, so your code executes on
  a vanilla runtime and stays portable to any other OTLP backend.
- **Cryptographically verified audit trail.** Every prompt read is written to a
  SHA-256 hash-chained log you can verify with one HTTP call.
- **100% self-hosted.** `docker compose up -d`. No seat licences, no trace quota,
  no Enterprise tier gating the deployment model — a free alternative to
  platforms where self-hosting starts in the four-figures-per-month range.

> **Trying Remi out?** Everything below is a fresh-clone path. If anything takes
> more than 10 minutes or doesn't behave as written, that's a bug — please tell
> us. See [Giving feedback](#giving-feedback).

---

## Why OpenTelemetry-native beats a proprietary SDK

Most LLM observability platforms ship a vendor SDK: you import their callback
handler, wrap your chain, and your application code now has a hard dependency on
their product. Remi inverts that.

| | Vendor SDK | Remi (OTLP) |
|---|---|---|
| **Agent code** | `from vendor import Handler` — imports, wrappers, callbacks | Nothing. Zero telemetry lines. |
| **Runtime** | Their SDK in your process, on your critical path | Vanilla runtime; the OTel launcher wraps it externally |
| **Switching cost** | Rip out every import and wrapper | Change one env var |
| **Language reach** | Whatever they wrote an SDK for | Any OpenTelemetry SDK — Python, Go, Java, Node, Rust |
| **Failure mode** | Vendor SDK bug is a bug in your agent | Exporter is out-of-process; agent is unaffected |

The bundled agents in [`examples/`](examples/) contain **zero telemetry code** —
no imports, no `TracerProvider`, no flush call. That's the whole point: what you
run in production is the agent you wrote, not the agent plus someone's SDK.

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

### Let an AI agent do the setup

Everything above is env vars and a launcher change, which is exactly the kind of
work a coding agent is good at. Copy the prompt below into Cursor, Claude Code,
or any coding agent **from inside your own agent's repo** — it will bring up the
stack and wire your agent into it.

````text
Set up Remi (self-hosted LLM observability) and point my agent at it.

Remi ingests OpenTelemetry traces. Do NOT add any SDK imports, callback handlers,
or TracerProvider code to my agent — instrumentation is env vars plus a launcher,
nothing else. If you find yourself editing my agent's Python to add telemetry, stop:
that is the wrong approach for this tool.

PART 1 — run the stack (in a separate directory, not my repo)

    git clone https://github.com/SA4DRAO/remi-observability.git
    cd remi-observability
    cp .env.example .env
    docker compose up -d --build     # first build takes a few minutes

Verify before continuing:
  - curl http://localhost:3100/api/v1/health   → {"status":"ok",...}
  - docker compose ps                          → every service Up
  - dashboard loads at http://localhost:3000

Notes:
  - .env accepts OPENROUTER_API_KEY or OPENAI_API_KEY. Needed ONLY for the
    LLM-as-judge feature and the bundled examples. Tracing works without one.
  - The demo-feeder service continuously runs demo agents against a demo org
    using that key. `docker compose stop demo-feeder` turns it off; nothing
    else is affected.

PART 2 — instrument my agent (this is the part in my repo)

Find my agent's entrypoint and every place that launches it, then:

1. Install the instrumentation:
       pip install opentelemetry-distro opentelemetry-instrumentation-langchain
       opentelemetry-bootstrap -a install

2. Set these env vars wherever my project already keeps config (.env, shell
   script, Dockerfile, process manager — match what I already use):

       OTEL_SERVICE_NAME="<the name my agent should appear under>"
       OTEL_TRACES_EXPORTER=otlp
       OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
       OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3100"
       OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer acme-ingest-key"
       OTEL_EXPERIMENTAL_RESOURCE_DETECTORS="os,process,host"
       OTEL_RESOURCE_ATTRIBUTES="service.version=1.0.0"

3. Change the launch command from:
       python my_agent.py
   to:
       opentelemetry-instrument python my_agent.py
   Update EVERY launcher: Makefile, Dockerfile CMD/ENTRYPOINT, docker-compose,
   CI workflow, run scripts, and the README.

Rules that will bite you if ignored:
  - Export to port 3100 (Remi's authenticated proxy), never 4318. The collector
    is bound to loopback and will refuse the connection.
  - acme-ingest-key is the seeded local dev key — correct for localhost, rotate
    before any real deployment.
  - Plain `python my_agent.py` still runs fine but exports nothing. The
    `opentelemetry-instrument` launcher is what turns instrumentation on.
  - If Remi runs on another host, replace localhost in the endpoint accordingly.

PART 3 — optional: group multi-step runs into one session

If my agent is LangChain/LangGraph and makes several model calls per logical run,
pass a stable thread id so they group into a single Remi session:

    agent.invoke({"messages": [...]}, config={"configurable": {"thread_id": "run-123"}})

This is the ONLY line that may touch my agent code, and it is optional. Without
it, each trace becomes its own session.

FINALLY

Run my agent once, then confirm the session appears at http://localhost:3000.
If it does not, check in this order: was it launched via opentelemetry-instrument,
is the endpoint :3100 (not :4318), and did the exporter log a 401 (wrong key)?
Report back what you changed and whether the session showed up.
````

## 4. What to look at

| Page | What it shows |
|---|---|
| **Sessions** | Every run. Click one for the flame chart, span tree, step-through replay, prompts/responses, and CPU/memory of the agent process. |
| **Analytics** | Cross-session rollups — volume, latency, tokens, per-model and per-agent breakdowns. |
| **Versions** | Per-release regression view. Set `service.version`, pick a baseline, and see latency/error/token/CPU deltas between releases of the *same* agent. "Judge 3" scores a random sample so quality columns fill in. |
| **⌘K / Ctrl-K** | Full-text search across span names, models, **and prompt/completion bodies**. |
| **Judge** | On any LLM span: scores correctness, instruction adherence, tool-use quality, and hallucination risk. Needs an LLM key. |

Also running: Jaeger at <http://localhost:16686> if you want raw trace inspection.

## 5. Compliance & access control

Three independent controls, all enforced server-side.

**Org scoping.** Every query is filtered by the org resolved from the API key.
Client-supplied org parameters are ignored — there is no request shape that
returns another tenant's spans.

**Scope-gated prompt redaction.** Prompt and completion bodies are gated behind
the `read:prompts` scope. Keys without it receive redacted attributes, and Cmd-K
will not match prompt text for them — the search gate is deliberate, since
without it a key that cannot *read* prompts could still probe their contents a
guess at a time by watching which queries return hits.

**Cryptographically verified audit trail.** Every prompt read, judge invocation,
and session deletion is appended to a SHA-256 **hash-chained** log in Postgres:
each entry commits to its predecessor's hash, so removing or editing any row
breaks every hash after it. Inserts are advisory-lock serialized so concurrent
writes can't fork the chain. Verify the whole chain for an org:

```bash
curl -H "Authorization: Bearer acme-admin-key" \
     http://localhost:3100/api/v1/admin/audit-log/verify
# {"success":true,"data":{"entries_checked":84,"broken_entry_ids":[],"valid":true}}
```

**PII scrubbing at the edge.** The collector redacts SSNs, credit-card numbers,
and email addresses out of span attributes *before* they reach storage — so the
raw values are never written to ClickHouse in the first place. The ruleset is
applied platform-wide and is configurable in
[`otel-collector-config.yaml`](otel-collector-config.yaml).

Seeded keys for local evaluation — **rotate these before any real use**:

| Org | Key | Scopes |
|-----|-----|--------|
| `acme` | `acme-admin-key` | everything (dashboard default) |
| `acme` | `acme-ingest-key` | `write:sessions` (point your agents here) |
| `demo-org` | `demo-view-key` | read-only, includes prompts |
| `demo-org` | `demo-ingest-key` | `write:sessions` (demo feeder) |

The dashboard accepts `?key=<api-key>` to switch keys without a rebuild — handy
for seeing exactly what a restricted key can and can't read.

**Customer logins (hosted deployment).** For anyone other than you to open the
dashboard, they need to sign in rather than carry a bearer key around. Caddy +
oauth2-proxy already handle this — Google OAuth in front, the dashboard behind
it, no login UI to build:

```
browser → Caddy (TLS, :443) → oauth2-proxy (Google OAuth) → backend/frontend
```

Unauthenticated requests get redirected to Google sign-in by Caddy before they
ever reach the app; on success Caddy forwards the verified email to the backend
over `X-Forwarded-Email`, authenticated by `PROXY_SHARED_SECRET` so it can't be
forged. The backend maps that email to an org via `org_members` — that row (not
the OAuth login) is the actual authorization check:

```sql
INSERT INTO org_members (email, org_id, scopes)
VALUES ('someone@customer.com', 'acme', ARRAY['read:sessions','read:spans']);
```

To turn it on:

1. In Google Cloud Console → APIs & Services → Credentials, create an OAuth
   client (type: Web application) with redirect URI
   `https://<your-domain>/oauth2/callback`.
2. Set in `.env`: `REMI_DOMAIN`, `OAUTH2_CLIENT_ID`, `OAUTH2_CLIENT_SECRET`,
   `PROXY_SHARED_SECRET` (`openssl rand -hex 32`), `OAUTH2_COOKIE_SECRET`
   (`openssl rand -base64 32 | head -c 32 | base64`), and optionally
   `OAUTH2_EMAIL_DOMAINS` to restrict who can even reach the login screen.
3. `docker compose --profile prod up -d --build` — this additionally starts
   `caddy` and `oauth2-proxy`, and Caddy auto-provisions TLS for `REMI_DOMAIN`.
4. Verify the auth boundary itself rejects forged headers and admits real ones —
   run from the host (backend's `3100` is loopback-only, deliberately not
   reachable from outside):
   `PROXY_SHARED_SECRET=<secret> MEMBER_EMAIL=<a seeded org_members email> ./scripts/check-auth.sh`.

Bearer API keys keep working unmodified alongside this — SSO is additive, not
a replacement, and it's what agents (which have no browser) keep using for
ingest.

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
