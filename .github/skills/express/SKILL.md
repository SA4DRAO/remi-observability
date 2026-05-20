---
name: "express"
description: "Express 5 TypeScript backend API for Remi with route factory pattern, Zod validation middleware, PostgreSQL (pg Pool), KafkaJS producer, and Redis. USE FOR: express routes, route factory pattern, createSessionsRoutes, createEventsRoutes, createHealthRoutes, express middleware, validateBody, zod schemas, request validation, pg client, DatabaseService, queryRead, storeSession, storeEvent, KafkaService, publishEventBatch, redis client, structured logging, typescript types, barrel exports, session management, events ingestion. DO NOT USE FOR: React components, TailwindCSS, TanStack Query, langchain callbacks, asyncpg, aiokafka consumer, Python code."
argument-hint: "[route or service topic]"
user-invokable: true
---

# Remi Express Backend

Express 5 TypeScript API located at `remi-backend/`. Service-oriented architecture with injectable factories, Zod request validation, and structured logging.

## Architecture Overview

```
remi-backend/src/
├── index.ts            # App bootstrap: wires services → routes
├── routes/
│   ├── sessions.routes.ts   – GET/POST /sessions, GET /:id/metrics
│   ├── events.routes.ts     – POST /events/batch, GET /sessions/:id/events
│   ├── health.routes.ts     – GET /health, /ready
│   └── index.ts             – barrel: re-exports all createXxxRoutes
├── services/
│   ├── database.service.ts  – DatabaseService (pg Pool wrapper)
│   ├── kafka.service.ts     – KafkaService (KafkaJS producer-only)
│   ├── redis.service.ts     – RedisService
│   ├── logger.ts            – Structured Logger interface + factory
│   └── index.ts             – barrel: re-exports all service classes
├── middleware/
│   ├── validation.ts        – validateBody<T>(ZodSchema) factory
│   ├── error-handler.ts     – centralised Express error handler
│   ├── auth.ts              – Bearer token check
│   └── request-logger.ts    – per-request timing log
└── types/
    ├── config.ts            – typed env-var config
    └── validation.ts        – shared Zod schemas (EventBatchSchema, …)
```

## Key Conventions

**Route factory pattern** — routes receive injected services, never import singletons:
```ts
export function createSessionsRoutes(
  getDatabase: () => DatabaseService | null,
  logger: Logger
): Router {
  const router = Router();
  // handlers close over getDatabase / logger
  return router;
}
```
`getDatabase` is a lazy getter (returns `null` when DB is unavailable) — always null-check and respond 503.

**Zod validation middleware**:
```ts
import { validateBody } from '../middleware';
router.post('/batch', validateBody(EventBatchSchema), async (req, res) => {
  const body = req.body; // fully typed and validated
});
```

**DatabaseService API** (key methods):
| Method | Purpose |
|---|---|
| `db.queryRead(sql, params)` | SELECT queries — returns pg `QueryResult` |
| `db.query(sql, params)` | Mutating queries (INSERT/UPDATE/DELETE) |
| `db.storeSession(id, name, metadata)` | Upserts a session row |
| `db.storeEvent(sessionId, type, data, seq?)` | Inserts a single event row |
| `db.getPoolStats()` | `{ total, idle, waiting }` for health checks |

**KafkaService API**:
```ts
await kafka.publishEventBatch(sessionId, events, topic?, { requestId });
// Wraps each event with session_id + ingest_request_id + timestamp
// Key = sessionId (ensures partition ordering per session)
```

**Structured logging**:
```ts
logger.info('Message', { contextKey: value });   // always pass context as 2nd arg
logger.warn('Slow query', { durationMs, query }); // not interpolated strings
```

## Decision Tree

```
Adding a new route group?
└─ Create routes/foo.routes.ts → export createFooRoutes(getDatabase, logger)
   → register in index.ts → add to routes/index.ts barrel

Need request body validation?
└─ Define Zod schema in types/validation.ts
   → apply validateBody(schema) before the handler
   → req.body is typed and safe inside the handler

Need to publish events to downstream worker?
└─ Use KafkaService.publishEventBatch() (not publishEvent directly)
   → Adds session_id, ingest_request_id, and timestamp automatically

Database unavailable at runtime?
└─ getDatabase() returns null → respond { success: false, error: 'Database not available' }, status 503
```

## Common Pitfalls

- ❌ Don't import `DatabaseService` as a module-level singleton in route files — ✅ Accept it via the factory parameter; makes routes testable and survives reconnection cycles.
- ❌ Don't `res.send()` without `return` in async handlers — ✅ Use `return` after every response to prevent "headers already sent" errors in Express 5.
- ❌ Don't add a new service file without updating `services/index.ts` — ✅ Always add a barrel export; callers import from `'../services'`, not individual files.
- ❌ Don't cast `req.body` manually after `validateBody` — ✅ The middleware replaces `req.body` with the parsed Zod output, so destructure it directly.
- ❌ Don't log sensitive fields (passwords, tokens) in context objects — ✅ Redact or omit before passing to `logger.*`.
