# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install

bun run dev          # Vite dev server with HMR (http://localhost:5173)
bun run type-check   # tsc --noEmit
bun run lint
bun run lint:fix
bun run format       # prettier --write
bun run build        # Vite production build → dist/
bun run preview      # serve dist/ locally

# Container build (Podman)
bun run container:build
bun run container:run
```

There are no automated tests in this package.

## Environment Variables

All config is read from `VITE_*` variables, which are **baked into the static bundle at build time** by Vite. They are not available at runtime.

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_API_URL` | `http://localhost:3100` | Backend base URL |
| `VITE_API_KEY` | `dev-key` | Bearer token sent on every request |
| `VITE_ENV` | `development` | `development` / `production` / `staging` |
| `VITE_ENABLE_DEBUG` | `false` | Enables verbose frontend logging |

In Docker, these are passed as build args (see root `docker-compose.yml`). The `serve` process at runtime does NOT use them.

## Architecture

### Data Layer

All server state is fetched via **TanStack Query** hooks in `src/hooks/`. The hooks call `apiClient` (a thin Axios wrapper in `src/utils/api-client.ts`) with `Authorization: Bearer <VITE_API_KEY>` pre-set on every request.

Key hooks:
- `useSessions` — paginated sessions list; supports `org_id`, `agent_id`, date range, status, cost filters
- `usePaginatedEvents` — paginated events for a session; optional `event_type` filter
- `useSessionMetrics` — per-session aggregated counts and costs
- `useAnalytics` — cross-session rollup for the analytics dashboard

### Pages and Routing

Routing is handled directly in `src/App.tsx` (no router library). Three page components:
- `SessionsPage` — main list view with filters
- `SessionDetailPage` — event timeline and metrics for one session
- `AnalyticsPage` — aggregate charts and breakdowns

### UI Components

`src/components/ui/` contains **shadcn/ui** wrappers over Radix UI primitives styled with Tailwind CSS v4. Add new primitives via the `shadcn` CLI (`bunx shadcn add <component>`). Do not modify the generated ui/ files directly unless fixing a bug; prefer wrapping them.

### Event Rendering

`src/components/Events/EventRenderers.tsx` maps `event_type` strings to structured display components. When adding a new event type, add a renderer there.

`src/utils/event-tree.ts` builds the parent/child span tree from `run_id` / `parent_run_id` fields for the trace view in `SessionDetailPage`.

### Logging

`src/utils/logger.ts` gates all output behind `VITE_ENABLE_DEBUG`. The Axios interceptors in `api-client.ts` use it for request/response tracing. Do not use `console.log` directly.
