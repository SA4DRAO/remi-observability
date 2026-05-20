# remi (frontend)

React 19 dashboard that displays LLM session timelines, token usage, and cost breakdowns sourced from the remi-backend REST API.

---

## What it does

- Shows a paginated list of LLM sessions with filtering by org, agent, date range, status, and cost
- Renders a per-session event timeline with parent/child span tree built from `run_id` / `parent_run_id`
- Provides an analytics view with cross-session token and cost rollups
- Polls the backend with TanStack Query; all data reads go through `Authorization: Bearer <VITE_API_KEY>`

---

## Prerequisites

| Tool    | Version  |
|---------|----------|
| Bun     | >= 1.0   |
| Node.js | >= 20    |

The backend must be running at the URL configured in `VITE_API_URL`.

---

## Quick start (local dev server)

```bash
cd remi/remi
bun install

# Configure env vars (see below) — create a .env.local file
echo "VITE_API_URL=http://localhost:3100" > .env.local
echo "VITE_API_KEY=dev-key" >> .env.local

bun run dev
# Dev server: http://localhost:5173 (HMR enabled)
```

---

## Development commands

```bash
bun run dev          # Vite dev server with HMR (http://localhost:5173)
bun run build        # Vite production build → dist/
bun run preview      # serve dist/ locally
bun run type-check   # tsc --noEmit
bun run lint         # eslint .
bun run lint:fix     # eslint . --fix
bun run format       # prettier --write .
```

There are no automated tests in this package.

---

## Environment variables

All `VITE_*` variables are **baked into the static bundle at build time** by Vite. They are not read at runtime. In Docker they are passed as build args (see root `docker-compose.yml`).

| Variable           | Default                  | Purpose                               |
|--------------------|--------------------------|---------------------------------------|
| `VITE_API_URL`     | `http://localhost:3100`  | Backend base URL                      |
| `VITE_API_KEY`     | `dev-key`                | Bearer token sent on every request    |
| `VITE_ENV`         | `development`            | `development` / `production` / `staging` |
| `VITE_ENABLE_DEBUG`| `false`                  | Enables verbose frontend logging      |

Set these in a `.env.local` file during local development. For Docker builds, edit the `build.args` section in `docker-compose.yml`.

---

## How it connects to other components

The frontend is a pure client — it only talks to remi-backend over HTTP:

```
remi (browser)
    │ GET /api/v1/sessions
    │ GET /api/v1/events
    │ GET /api/v1/sessions/:id/metrics
    │ GET /api/v1/analytics
    ▼
remi-backend :3100
```

No direct database or Kafka access.

---

## Adding a shadcn/ui component

```bash
bunx shadcn add <component-name>
```

Generated files land in `src/components/ui/`. Do not modify them directly unless fixing a bug; wrap them instead.
