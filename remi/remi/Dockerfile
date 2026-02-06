FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build && test -d dist && test -f dist/index.html || (echo "Build failed: dist/index.html not found" && exit 1)

# Production image
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

# Copy built assets from builder
COPY --from=builder /app/dist ./dist

# Install curl for health checks
RUN apk add --no-cache curl

# Install a simple HTTP server to serve the built app
RUN npm install -g serve

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["serve", "-s", "dist", "-l", "3000"]
