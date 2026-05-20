FROM docker.io/oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

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

# Install a simple HTTP server to serve the built app
RUN bun install -g serve

EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["serve", "-s", "dist", "-l", "3000"]
