---
name: "express"
description: "Express 5 route factory pattern (create*Routes with injected getDatabase and logger), service-oriented classes for Postgres/Kafka/Redis, Zod request validation middleware, structured logging conventions, and barrel export pattern in src/services/ and src/routes/"
applyTo: "remi-backend/src/**/*.ts"
---

# Express Backend Standards — Remi Backend API

## Route Factory Pattern

- Every route module exports a single factory function named `create<Domain>Routes` that accepts service getters and a `logger` — never create module-level service singletons or call `getDatabase()` at module load time
- Service getters are `() => ServiceClass | null`; always guard with an early `if (!db)` → `res.status(503).json({ success: false, error: 'Database not available' })` before any query — the services initialise asynchronously and may be `null` at startup
- Route handlers must declare an explicit `Promise<void>` return type; Express 5 propagates unhandled rejections but explicit types prevent accidental `return res.json(...)` mismatches
- Only one router per factory function; mount child routers with `router.use()` in `src/index.ts`

```ts
// src/routes/sessions.routes.ts — canonical factory shape
import { Router } from "express";
import type { Request, Response } from "express";
import type { DatabaseService } from "../services";
import type { Logger } from "../services/logger";

export function createSessionsRoutes(
  getDatabase: () => DatabaseService | null,
  logger: Logger
): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response): Promise<void> => {
    const db = getDatabase();
    if (!db) {
      res.status(503).json({ success: false, error: "Database not available" });
      return;
    }
    try {
      // ... query
      res.json({ success: true, data: { sessions: result.rows } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error("Error listing sessions:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
```

## Service Injection

- The three infrastructure services are `DatabaseService`, `KafkaService`, and `RedisService`; import types from the barrel `../services` — never import directly from the implementation file in route modules
- Route factories that need multiple services receive one getter per service (`getDatabase`, `getKafka`, `getRedis`) — do not bundle them into a single options object, as partial injection would be ambiguous
- Services expose typed methods (`db.queryRead`, `db.storeSession`, `kafka.publish`, `redis.getJSON`) — do not access the underlying `pool` or client directly from route handlers

```ts
// src/routes/events.routes.ts — multi-service injection
import { DatabaseService, KafkaService, RedisService } from "../services";
import { Logger } from "../services/logger";

export function createEventsRoutes(
  getDatabase: () => DatabaseService | null,
  getKafka: () => KafkaService | null,
  getRedis: () => RedisService | null,
  logger: Logger
): Router {
  const router = Router();
  // getKafka() / getRedis() may each be null; guard each independently
  router.post("/batch", requireApiKey, validateBody(EventBatchSchema), async (req, res): Promise<void> => {
    const kafka = getKafka();
    if (!kafka) {
      res.status(503).json({ success: false, error: "Kafka not available" });
      return;
    }
    // ...
  });
  return router;
}
```

## Request Validation

- All `POST`/`PUT`/`PATCH` handlers that read `req.body` must be guarded by `validateBody(ZodSchema)` middleware (from `../middleware`) before the handler — never trust raw `req.body` even for optional fields
- Define Zod schemas in `src/types/validation.ts`; export both the schema and the inferred TypeScript type (`export type ValidatedEventBatch = z.infer<typeof EventBatchSchema>`) so handler code references the type, not the schema
- `validateBody` calls `schema.parse(req.body)` and replaces `req.body` with the validated value; downstream handlers can safely cast `req.body as ValidatedType`
- Query-string parameters are parsed manually with `parseInt` / type assertions (see existing pattern); add boundary checks (`Math.min(parseInt(...) || 50, 500)`) for any numeric limit

```ts
// src/types/validation.ts
import { z } from "zod";

export const EventBatchSchema = z.object({
  session_id: z.string().min(1),
  events: z.array(z.record(z.unknown())).min(1).max(1000),
});
export type ValidatedEventBatch = z.infer<typeof EventBatchSchema>;

// src/routes/events.routes.ts — usage
import { requireApiKey, validateBody } from "../middleware";
import { EventBatchSchema } from "../types/validation";

router.post("/batch", requireApiKey, validateBody(EventBatchSchema), async (req, res): Promise<void> => {
  const { session_id, events } = req.body as ValidatedEventBatch;
  // ...
});
```

## Structured Logging

- Use the injected `logger` exclusively — never `console.log/error/warn` in route or service code; the logger is the single observability channel
- Call `logger.info` for state-changing operations (session created, batch published), `logger.debug` for cache hits and intermediate query info, `logger.warn` for degraded but non-fatal conditions (e.g. Redis unavailable), `logger.error` for all caught exceptions
- Always include a context object as the second argument when logging structured data so log aggregators can index fields; do not interpolate values directly into the message string for structured fields

```ts
// ✅ structured context object
logger.debug("Session events query start", {
  requestId,
  sessionId,
  limit,
  offset,
  eventType: eventType ?? null,
});
logger.error("Error listing sessions:", error); // Error instance as second arg

// ❌ avoid string interpolation for structured fields
logger.info(`Query offset=${offset} limit=${limit}`);
```

## Error Handling

- Wrap every async handler body in `try/catch`; normalise the caught value with `err instanceof Error ? err : new Error(String(err))` before passing to `logger.error` and returning in the JSON body — guarantees `.message` is always a string
- Never leak stack traces or internal connection strings in response bodies; return `error.message` only
- 503 for unavailable infrastructure, 404 for missing records, 400 for validation failures (handled by `validateBody`), 500 for unexpected errors — no 200 with `success: false` for infrastructure errors

```ts
// error normalisation pattern — used in every route handler catch block
} catch (err) {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error("Error fetching metrics for session:", error);
  res.status(500).json({ success: false, error: error.message });
}
```

## TypeScript Strictness

- Strict mode is enabled (`tsconfig.json`); `any` is never acceptable — use `unknown` for caught errors, `Record<string, unknown>` for free-form JSON, and explicit row type aliases for raw DB rows
- Cast Postgres result rows to named types at the query boundary rather than spreading `any` through the handler; use `as` assertions only where the schema is known (e.g. `statsResult.rows[0] as StatsRow`)
- Export `type` (not `interface`) for inferred Zod types; use `interface` for hand-written domain shapes

## Barrel Exports

- Every new service class added to `src/services/` must be re-exported from `src/services/index.ts` — the existing exports are `Logger`, `KafkaService`, `RedisService`, `DatabaseService`
- Every new route factory added to `src/routes/` must be re-exported from `src/routes/index.ts` — consumers import from the barrel, never from individual route files
- Failing to update barrels breaks compile-time imports in `src/index.ts` and downstream test files

```ts
// src/services/index.ts — append new exports here
export { Logger } from "./logger";
export { KafkaService } from "./kafka.service";
export { RedisService } from "./redis.service";
export { DatabaseService } from "./database.service";
// export { NewService } from "./new.service";   ← add here

// src/routes/index.ts — append new exports here
export { createSessionsRoutes } from "./sessions.routes";
export { createEventsRoutes } from "./events.routes";
export { createHealthRoutes } from "./health.routes";
// export { createNewRoutes } from "./new.routes";  ← add here
```
