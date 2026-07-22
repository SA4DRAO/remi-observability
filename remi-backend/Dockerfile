FROM docker.io/oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY src/ ./src/
COPY tsconfig.json ./
RUN bun run build

# ── Production image ──────────────────────────────────────────────────────────
FROM docker.io/oven/bun:1-alpine

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist

USER nodejs

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3100/health || exit 1

EXPOSE 3100

CMD ["bun", "dist/index.js"]
