FROM docker.io/oven/bun:1-alpine AS builder

WORKDIR /app

# VITE_* vars are baked into the static bundle at build time.
# Supplied via docker-compose build.args or --build-arg.
ARG VITE_API_URL=http://localhost:3100
ARG VITE_API_KEY=test-key-123
ARG VITE_ENV=development
ARG VITE_ENABLE_DEBUG=false

ENV VITE_API_URL=$VITE_API_URL \
    VITE_API_KEY=$VITE_API_KEY \
    VITE_ENV=$VITE_ENV \
    VITE_ENABLE_DEBUG=$VITE_ENABLE_DEBUG

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build && test -f dist/index.html

# ── Production image ──────────────────────────────────────────────────────────
FROM docker.io/oven/bun:1-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "run", "node_modules/.bin/serve", "-s", "dist", "-l", "3000"]
