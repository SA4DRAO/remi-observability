---
name: "react"
description: "React 19 + Vite frontend for the Remi LLM observability dashboard with TanStack Query, Radix UI / shadcn, and TailwindCSS. USE FOR: react components, vite config, tanstack query hooks, useQuery, useMutation, useQueryClient, query invalidation, refetchInterval polling, keepPreviousData pagination, radix ui, shadcn components, tailwind styling, custom hooks, useSessions, usePaginatedEvents, useAggregatedEvents, useSessionMetrics, session dashboard, event viewer, metrics display, zod validation, axios api client, apiClient, sentry error tracking. DO NOT USE FOR: express routes, kafka producer, postgresql queries, langchain callbacks, asyncpg, aiokafka worker, Python code."
argument-hint: "[component or hook topic]"
user-invokable: true
---

# Remi React Frontend

React 19 SPA located at `remi/remi/`. Vite build, TanStack Query for all server state, shadcn/Radix UI components, TailwindCSS utilities.

## Architecture Overview

```
remi/remi/src/
├── hooks/          # TanStack Query hooks (only place server state lives)
│   ├── useSessions.ts          – session list + aggregated stats + delete
│   ├── usePaginatedEvents.ts   – paginated event list + aggregated counts
│   ├── useSessionMetrics.ts    – per-session metrics from /sessions/:id/metrics
│   └── useTheme.ts             – dark/light mode toggle
├── components/
│   ├── ui/         # shadcn wrappers over Radix primitives (Button, Card, …)
│   ├── Pages/      # Route-level page components
│   └── Events/     # Event-specific display components
├── types/          # Zod schemas + inferred TS types for API responses
├── utils/
│   ├── api-client.ts   # Axios instance (base URL from env, auth header)
│   └── logger.ts       # Browser console logger with levels
└── lib/utils.ts    # cn() and other shared helpers
```

## Key Conventions

**Server state always lives in hooks** — never `useState` + `useEffect` for data fetched from the API.

**Polling pattern** (`useSessions`):
```ts
const { data, isPending, isFetching, error, refetch } = useQuery({
  queryKey: ["sessions", limit],
  queryFn: () => apiClient.get("/api/v1/sessions", { params: { limit } }),
  refetchInterval: pollingInterval,          // e.g. 10_000 ms
  staleTime: Math.max(pollingInterval - 2_000, 3_000),  // avoids over-fetching
  gcTime: 5 * 60 * 1000,
});
```

**Pagination with stable UI** (`usePaginatedEvents`):
```ts
useQuery({
  queryKey: ["events", "paginated", sessionId, limit, offset, eventType],
  placeholderData: keepPreviousData,  // keeps prior page visible during load
  staleTime: 30_000,
});
```

**Delete → invalidate** (`useSessions`):
```ts
const deleteMutation = useMutation({
  mutationFn: (id) => apiClient.delete(`/api/v1/events/session/${id}`),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    queryClient.invalidateQueries({ queryKey: ["events"] });
  },
});
```

## Decision Tree

```
Need data from API?
├─ List/aggregate → useQuery with refetchInterval (polling)
├─ Single-session metrics → useQuery with staleTime: 30s
├─ Paginated list → useQuery + keepPreviousData
└─ Mutation (create/delete) → useMutation + invalidateQueries on success

Need a UI primitive?
├─ Button, Card, Badge, Table … → src/components/ui/ (shadcn wrapper)
├─ Layout/spacing → TailwindCSS utility classes
└─ Never import @radix-ui/* directly in page code
```

## Common Pitfalls

- ❌ Don't use `useState` + `useEffect` for API data — ✅ Use a `useQuery` hook; stale data, loading states, and caching are handled automatically.
- ❌ Don't import Radix primitives directly in feature components — ✅ Import from `src/components/ui/` (the shadcn wrapper layer adds consistent styling and accessible defaults).
- ❌ Don't forget to update `queryKey` when adding filter params — ✅ Include every param that changes the result in the key array so TanStack Query caches correctly per combination.
- ❌ Don't skip Zod validation on API responses — ✅ Parse with the schema in `src/types/` before using data; type mismatches surface at the boundary, not deep in the render tree.
- ❌ Don't call `refetch()` imperiously after a mutation — ✅ Call `queryClient.invalidateQueries` instead; the query re-fetches automatically on next render.
