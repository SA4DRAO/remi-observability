# Multi-stage build for optimal image size
FROM docker.io/oven/bun:1-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Build TypeScript
COPY . .
RUN bun run build

# Production stage
FROM docker.io/oven/bun:1-alpine

WORKDIR /app

# Install only production dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Health check (wget is provided by busybox in alpine – no extra install needed)
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3100/health || exit 1

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3100

CMD ["bun", "dist/index.js"]
