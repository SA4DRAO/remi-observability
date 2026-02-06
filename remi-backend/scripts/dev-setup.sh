#!/bin/bash

# Local development startup with docker-compose
# Usage: ./scripts/dev-setup.sh

set -e

echo "📦 Installing dependencies..."
npm install

echo "🔨 Building TypeScript..."
npm run build

echo "🐳 Starting Docker Compose..."
npm run docker:rebuild

echo "✅ Development environment ready!"
echo ""
echo "Access the API at: http://localhost:3100"
echo "Health check: http://localhost:3100/health"
echo ""
echo "Useful commands:"
echo "  npm run dev:watch     - Start with file watching"
echo "  npm run docker:logs   - View container logs"
echo "  npm run docker:down   - Stop containers"
echo "  npm run lint:fix      - Fix linting issues"
