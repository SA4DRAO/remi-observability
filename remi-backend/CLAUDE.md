# CLAUDE.md — DEPRECATED

> **This package is dead code, kept only for reference.**
>
> The backend is now [`remi-backend-spring/`](../remi-backend-spring/) (Java 21 /
> Spring Boot). This Node/Express/Bun service has been fully superseded and is
> **not** wired into the root `docker-compose.yml`, does **not** build (a stale
> `createHealthRoutes` default re-export in `src/routes/index.ts` vs. its named
> export), and references modules that were deleted (`otlp.service.ts`,
> `kafka.service.ts`, `traces.routes.ts`, `org-id.ts`).
>
> **Do not extend or run this.** Work on the Spring backend instead. See the
> root `CLAUDE.md` for the current architecture. This directory will be removed
> once nothing references it for historical context.
