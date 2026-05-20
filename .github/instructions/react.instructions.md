---
name: "react"
description: "React 19 functional components with TanStack Query for server state, Radix UI + shadcn/ui component patterns, TailwindCSS utility classes, custom hooks in src/hooks/ with typed interfaces, and Zod schema validation for API responses"
applyTo: "remi/remi/src/**/*.{tsx,ts,css}"
---

# React Frontend Standards — Remi Observability UI

## Server State & Data Fetching

- All remote data goes through `useQuery` / `useMutation` / `useQueryClient` from `@tanstack/react-query` — never fetch with raw `fetch` or Axios calls inside components
- Use `refetchInterval` for polling dashboards (default `10_000` ms); pair with `staleTime` set to `pollingInterval - 2_000` (minimum `3_000`) so TanStack Query doesn't issue a redundant request immediately after a fresh response
- Always call `queryClient.invalidateQueries` in `onSuccess` of every mutation that changes shared data — both the directly mutated resource and any derived queries (e.g. deleting a session also invalidates `["events"]`)
- Set `gcTime: 5 * 60 * 1000` on queries with polling intervals to prevent stale data from being evicted too aggressively
- Use `keepPreviousData` (via `placeholderData: keepPreviousData`) on paginated queries so the UI doesn't flash empty state between page navigations
- Wrap `queryFn` in `try/catch`; log failures via `logger.error` and re-`throw` — TanStack Query must see the rejection to mark the query as errored

```ts
// src/hooks/useSessions.ts — preferred pattern
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";

export interface SessionSummary {
  session_id: string;
  name: string | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  is_complete: boolean | null;
}

interface UseSessionsOptions {
  pollingInterval?: number;
  limit?: number;
}

export function useSessions({ pollingInterval = 10_000, limit = 50 }: UseSessionsOptions = {}) {
  const queryClient = useQueryClient();

  const query = useQuery<SessionsResponse>({
    queryKey: ["sessions", limit],
    queryFn: async () => {
      try {
        const res = await apiClient.get<SessionsResponse>("/api/v1/sessions", {
          params: { limit },
        });
        logger.debug(`Fetched ${res.data.sessions.length} sessions`);
        return res;
      } catch (e) {
        logger.error("Failed to fetch sessions", e);
        throw e;
      }
    },
    refetchInterval: pollingInterval,
    refetchOnWindowFocus: true,
    staleTime: Math.max(pollingInterval - 2_000, 3_000),
    gcTime: 5 * 60 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiClient.delete(`/api/v1/events/session/${sessionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (err) => logger.error("Failed to delete session", err),
  });

  return { ...query, deleteSession: deleteMutation.mutateAsync };
}
```

## HTTP Client

- Always import the pre-configured Axios instance from `../utils/api-client` (exported as `apiClient`) — never instantiate `axios` or call `fetch` directly in hooks or components
- The `apiClient` has base URL, auth headers, and timeout already configured; adding a second Axios instance creates silent config drift
- Type the Axios generic `apiClient.get<T>()` at the call site so the return type flows into TanStack Query's `data` inference

```ts
// ✅ correct
import { apiClient } from "../utils/api-client";
const res = await apiClient.get<PaginatedEventsResponse>("/api/v1/events/sessions/:id/events");

// ❌ wrong — bypasses configured interceptors
import axios from "axios";
const res = await axios.get("/api/v1/...");
```

## Custom Hooks

- Every hook that wraps a remote resource lives in `src/hooks/` and is the sole owner of its `queryKey` structure — components never construct raw `queryKey` arrays themselves
- Export a named TypeScript `interface` for every response shape (e.g. `SessionSummary`, `PaginatedEventsResponse`) from the hook file itself — backend shapes change frequently and co-locating them with the query keeps updates atomic
- Return structured objects from hooks, not raw query results: map `data?.data?.sessions ?? []` before returning so consumers never need to navigate nested optionals
- Error values returned from hooks must be `Error | null` (cast with `err instanceof Error ? err : null`) so components can call `.message` safely

```ts
// src/hooks/usePaginatedEvents.ts — shape ownership at the hook boundary
export interface PaginatedEventsResponse {
  success: boolean;
  data: {
    events: CallbackEvent[];
    pagination: { limit: number; offset: number; total: number; hasMore: boolean };
  };
}

export const usePaginatedEvents = ({ sessionId, limit = 50 }: UsePaginatedEventsOptions) => {
  const { data, isPending, error, refetch, isFetching } = useQuery<PaginatedEventsResponse, Error>({
    queryKey: ["events", "paginated", sessionId, limit],
    queryFn: async () => { /* ... */ },
    placeholderData: keepPreviousData,
    enabled: !!sessionId,
    staleTime: 30_000,
  });

  return {
    events: data?.data.events ?? [],
    pagination: data?.data.pagination ?? { limit, offset: 0, total: 0, hasMore: false },
    isPending,
    isFetching,
    error: error instanceof Error ? error : null,
    refetch,
  };
};
```

## Component Architecture

- Use functional components exclusively — no class components; React 19 Server Components require function-based composition
- Define a named `interface` for every component's props (`interface UserCardProps { ... }`) — never use inline type objects or `React.FC<{...}>` inline generics
- Wrap all Radix UI primitives in `src/components/ui/` before use in feature components — this creates a single upgrade seam when Radix changes its API (see existing `badge.tsx`, `button.tsx`, `card.tsx`, `scroll-area.tsx`, `select.tsx`)
- Never co-locate business logic in UI leaf components; keep them purely presentational and push data access into hooks

```tsx
// src/components/ui/badge.tsx — Radix wrapper pattern
import * as RadixBadge from "@radix-ui/react-badge";
import { cn } from "../../lib/utils";

interface BadgeProps {
  variant?: "default" | "error" | "success";
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}
```

## Styling

- Use TailwindCSS utility classes exclusively — no inline `style` props, no CSS-in-JS, no hand-written class strings outside Tailwind — the `tailwind.config.ts` is the single source of design tokens
- Apply responsive variants via Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`) — never use media queries in CSS files for layout concerns
- Compose dynamic classes with `cn()` (from `src/lib/utils.ts`) — it correctly merges Tailwind conflict rules (e.g. `cn("px-2", condition && "px-4")` → `"px-4"` not `"px-2 px-4"`)
- Global styles belong in `src/index.css` only; component-scoped CSS files are permitted but must not duplicate Tailwind utilities

```tsx
// ✅ Tailwind + cn pattern
<div className={cn(
  "flex items-center gap-2 rounded-md border px-4 py-2 text-sm",
  isError && "border-red-500 bg-red-50 text-red-700",
  isComplete && "border-green-500 bg-green-50"
)}>
  {children}
</div>

// ❌ no inline styles
<div style={{ display: "flex", padding: "8px" }}>
```

## Logging

- Import `logger` from `../utils/logger` — it is the project-wide structured logger; never use bare `console.log/error/warn` in production paths
- Use `logger.debug` for successful data fetches, `logger.info` for mutations that change state, `logger.error` for caught exceptions — matching the severity conventions in `useSessions.ts` and `usePaginatedEvents.ts`

```ts
// ✅ structured logging
logger.debug(`Fetched ${res.data.events.length} events (limit=${limit}, offset=${offset})`);
logger.error("Failed to fetch paginated events:", error);

// ❌ do not use
console.log("fetched", data);
```
