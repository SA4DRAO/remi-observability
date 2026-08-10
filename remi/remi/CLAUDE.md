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
bun run format:check # prettier --check (CI-safe)
bun run build        # Vite production build → dist/
bun run preview      # serve dist/ locally (http://localhost:4173)

# Standalone container build. The normal path is `docker compose build frontend`
# from the repo root, which passes the VITE_* build args; these two do not.
bun run container:build
bun run container:run
```

`bun test` runs the one test file in this package (`src/utils/attention.test.ts`,
covering the overview's "needs attention" thresholds). There is no browser-level
test setup — everything else is verified against the live stack.

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
- `useAnalytics` — cross-session rollup; also exports `useVersionComparison` and `useSampleJudge` for the per-agent version view.
  `useVersionComparison(agentId, dateFrom)` takes the **same window** as `useAnalytics` — the overview renders the two
  feeds side by side (regression alerts, the agent table's p95 column), so an unscoped version query date-mismatches
  every row it lands next to. Pass `dateFrom(scope.days)` at every call site.
- `useTheme` — light/dark toggle

### Pages and Routing

Routing is handled directly in `src/App.tsx` (no router library — a `page` state var
plus a `sessionId` that switches the shell into the trace layout). Page components
live in `src/components/Pages/`:
- `OverviewPage` — headline KPI strip, throughput chart, "needs attention" list, agent health table, latest runs
- `SessionsPage` — dense session table with CSV export and pagination
- `TracePage` — full-height split: span views on the left, `SpanInspector` rail (400px) on the right
- `AnalyticsPage` — totals strip, latency/token charts, model table, daily values behind a `<details>`
- `VersionComparison` — the Versions page: one section per agent, its own baseline radio

**Scope is global.** `ScopeBar` (agent / time range / status) sits under the header on
every page except the trace view. The selection lives in `App` as a `Scope`
(`src/lib/scope.ts`) and is passed to each page, which turns it into query params —
so the filter row is not decoration, it drives every request. `dateFrom(days)` is the
single place a range becomes a `date_from`.

### Span Views

Spans are the core unit (the old event-based renderers are gone). The trace page
picks one of three left-pane views, all of which write into the same selected-span
state that the inspector reads:
- `SpanTree.tsx` — default. Hierarchy on the left, waterfall bar on the right, one row per span
- `FlameChart.tsx` — lane-packed timeline showing concurrency, no external gantt lib
- `SessionReplay.tsx` — prev/next stepper plus a proportional ribbon; content is rendered by the inspector, not here

`SpanInspector.tsx` is the right rail (it replaced the old `SpanDetailPanel`
slide-over) with four tabs:
- **Span** — prompt/response extracted across OTel naming variants (`gen_ai.*`, `llm.*`, `traceloop.*`), attributes, and the "run LLM judge" trigger
- **Session** — models, tools, runtime resource attributes
- **System** — `SystemMetricsPanel` CPU/memory charts
- **Judge** — the verdict: summary, scores, flags, time breakdown, suggestions

The selected span is *derived*, not stored: `TracePage` keeps a `pickedSpanId` and
falls back to the slowest LLM span, so a trace opens on the row you'd have clicked.

### Design System

The dashboard is a **data console**: 12px base, JetBrains Mono throughout, 10px
uppercase tracked labels, tabular numerals, 28px control height, 1440px shell.

The shared surfaces live as plain CSS classes in `src/index.css` under
`@layer components` — `.panel`, `.dtable` (+ `.num` / `.dim`), `.ctl` / `.ctl-sm`,
`.seg`, `.chip`, `.kicker`, `.sect-title`, `.bar`, `.dot`, `pre.code`, `.shell`.
**Reach for these before writing utility strings**; a new table or control that
hand-rolls padding and border colors will drift from everything else.

Semantic color tokens (`--ok`, `--warn`, `--err`, `--info`, `--subtle`) are defined
per theme alongside the shadcn tokens and registered in `@theme inline`, so both
`var(--err)` and `text-err` work. Charts read `--chart-1/2/5` and `--chart-err`;
shared recharts config is in `src/lib/chart.ts`. Status/kind → color goes through
`spanColor()` / `statusColor()` in `utils/format.ts` so a span is the same color in
every view. Deltas always carry an arrow and a number — color is never the only signal.

`src/components/ui/` is down to `skeleton.tsx`; the rest of the shadcn/Radix wrappers
were replaced by the classes above, and `@radix-ui/*` is no longer a dependency.
Add primitives back with `bunx shadcn add <component>` (the `shadcn` CLI is a
devDependency and `components.json` is still configured) only when a real
interaction — focus trap, listbox, portal — needs one, not for static styling.
Re-adding one pulls Radix back in; if the bundle grows enough to care, restore the
`radix` chunk in `vite.config.ts` that was dropped when the wrappers went.

### Logging

`src/utils/logger.ts` gates all output behind `VITE_ENABLE_DEBUG`. The Axios interceptors in `api-client.ts` use it for request/response tracing. Do not use `console.log` directly.
