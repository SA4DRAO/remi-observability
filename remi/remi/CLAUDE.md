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
| `VITE_API_URL` | `http://localhost:3100` on localhost, else same-origin (`""`) | Backend base URL |
| `VITE_API_KEY` | `dev-key` | Fallback bearer token (see key resolution below) |
| `VITE_ENV` | `development` | `development` / `production` / `staging` |
| `VITE_ENABLE_DEBUG` | `false` | Enables verbose frontend logging |

In Docker, these are passed as build args (see root `docker-compose.yml`). The `serve` process at runtime does NOT use them.

**API key resolution** (`resolveApiKey` in `src/config/env.ts`): a `?key=<api-key>` URL query param wins and is persisted to `localStorage["remi_api_key"]`; otherwise the order is localStorage → `VITE_API_KEY` → `"dev-key"`. This lets the marketing "live demo" link hand off a read-only key without a rebuild.

## Architecture

The dashboard reads OTLP-derived **spans and sessions** from the Spring backend (`remi-backend-spring/`). There is deliberately no cost tracking — latency (avg/p95 LLM span duration) is the efficiency metric.

### Data Layer

All server state is fetched via **TanStack Query** hooks in `src/hooks/`. The hooks call `apiClient` (a thin Axios wrapper in `src/utils/api-client.ts`) which sends `Authorization: Bearer <resolved key>` on every request and surfaces `{success:false,error}` server messages as `error.message`.

Hooks:
- `useSessions` — paginated sessions list; filters: `agent_id`, date range, status
- `useSession` — one session's detail (models + tools breakdown, resource attributes)
- `useSpans` — spans for a session (built into a tree via `utils/span-tree.ts`)
- `useSpanAttributes` — raw attributes for one span
- `useSpanSearch` — full-text search over span prompts/completions (Cmd/Ctrl+K)
- `useSpanAnalysis` — LLM-as-judge verdict for a span (`POST /sessions/:id/analyze-span`)
- `useSystemMetrics` — per-session CPU/memory time series
- `useAnalytics` — cross-session rollup; also exports `useVersionComparison` and `useSampleJudge` for the per-agent version view
- `useTheme` — light/dark toggle

### Pages and Routing

Routing is handled directly in `src/App.tsx` (no router library — an `activePage` state var plus a `selectedSessionId` override). Page components in `src/components/Pages/`:
- `SessionsPage` — main list view with filters and quick stats
- `SessionDetailPage` — session metadata, span views (Tree / Flame / Replay toggle), `SystemMetricsPanel`, runtime-environment card, model/tool usage tables
- `AnalyticsPage` — totals, recharts time series (sessions/latency/tokens per day), model + agent breakdowns, and the embedded `VersionComparison` section

### Span Views

Spans are the core unit (the old event-based renderers are gone). Four views:
- `SpanTree.tsx` — collapsible hierarchy via `buildSpanTree`/`flattenSpanTree` (`utils/span-tree.ts`), inline mini-bar per row
- `FlameChart.tsx` — custom lane-packing timeline, no external gantt lib
- `SessionReplay.tsx` — step-through single-span viewer with prompt/completion + Analyze trigger
- `SpanDetailPanel.tsx` — slide-over with attributes, prompt/completion extraction across OTel naming variants (`gen_ai.*`, `llm.*`, `traceloop.*`), and the AI-analysis (judge) section

### UI Components

`src/components/ui/` contains **shadcn/ui** wrappers over Radix UI primitives styled with Tailwind CSS v4. Add new primitives via the `shadcn` CLI (`bunx shadcn add <component>`). Do not modify the generated ui/ files directly unless fixing a bug; prefer wrapping them.

### Logging

`src/utils/logger.ts` gates all output behind `VITE_ENABLE_DEBUG`. The Axios interceptors in `api-client.ts` use it for request/response tracing. Do not use `console.log` directly.
