FROM docker.io/oven/bun:1-alpine AS builder

WORKDIR /app

# Declare build-time variables so Vite can bake them into the static bundle.
# Values are supplied via docker-compose build.args (or --build-arg).
ARG VITE_API_URL=http://localhost:3100
ARG VITE_API_KEY=test-key-123
ARG VITE_ENV=development
ARG VITE_ENABLE_DEBUG=false

# Expose them to the bun build process
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_KEY=$VITE_API_KEY
ENV VITE_ENV=$VITE_ENV
ENV VITE_ENABLE_DEBUG=$VITE_ENABLE_DEBUG

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN bun run build && test -d dist && test -f dist/index.html || (echo "Build failed: dist/index.html not found" && exit 1)

# Production image
FROM docker.io/oven/bun:1-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

# Copy built assets from builder
COPY --from=builder /app/dist ./dist

# Install curl for health checks
RUN apk add --no-cache curl

# Install a simple HTTP server to serve the built app
RUN bun install -g serve

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["serve", "-s", "dist", "-l", "3000"]
