---
name: "remi"
description: "Build and extend Remi observability features across the React dashboard, Express backend, LangChain Python SDK, and async Kafka worker"
agent: "Remi Platform Coordinator"
argument-hint: "[feature or task] [packages affected]"
---

Build or extend a feature in the **Remi LLM observability platform** monorepo. Remi spans four packages — route work to the correct agent(s) based on scope.

**Task:** ${input:task:Describe the feature or task (e.g., "add token cost breakdown by model", "fix session metrics bug")}

**Current file context:** ${file}

## Agent Routing

| Scope | Agent |
|-------|-------|
| Cross-package (data model → API → UI → worker) | @Remi Platform Coordinator |
| Dashboard UI only (`remi/`) | @React Frontend |
| REST API only (`remi-backend/`) | @Express Backend |
| Callback SDK only (`remi-langchain/`) | @LangChain Observability SDK |
| Event pipeline only (`remi-worker/`) | @Async Kafka Worker |

## Key Patterns

1. **`remi/`** — TanStack Query hooks (`useQuery`, `useMutation`) for all server state; co-locate hooks with feature components
2. **`remi-backend/`** — Express route factory pattern; add new endpoints via the route factory and attach to the router index
3. **`remi-langchain/`** — Extend `BaseCallbackHandler`; implement only the lifecycle hooks needed (`handleLLMEnd`, `handleChainEnd`, etc.) and emit structured events to Kafka
4. **`remi-worker/`** — KafkaConsumer batch processing; handle each message type in an isolated processor, commit offsets only after successful writes

## Output Format

Respond with a **per-package plan** structured as follows:

### `<package-name>/`
- **Files to change:** list each file path relative to the package root
- **Changes:** specific code additions, modifications, or deletions for each file
- **Dependencies:** any new packages, env vars, or schema migrations required

Finish with an **integration checklist** covering: API contract alignment, shared type definitions, Kafka topic/schema changes, and any Docker Compose service updates needed in `docker-compose.yml`.
