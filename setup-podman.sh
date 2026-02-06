#!/bin/bash

# Quick Podman Setup Script for Remi Project
# Run this to quickly set up and run the project with Podman

set -e

echo "🚀 Remi Project - Podman Quick Setup"
echo "======================================"
echo ""

# Check if podman is installed
if ! command -v podman &> /dev/null; then
    echo "❌ Podman is not installed"
    echo "Please install Podman first:"
    echo "  macOS: brew install podman"
    echo "  Ubuntu/Debian: sudo apt-get install podman"
    echo "  Fedora: sudo dnf install podman"
    exit 1
fi

echo "✅ Podman is installed: $(podman --version)"
echo ""

# Check if on macOS and if machine is running
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🍎 Detected macOS"
    if ! podman machine ls --format "{{.Name}}" | grep -q podman-machine-default; then
        echo "⚠️  Podman machine not found. Creating..."
        podman machine init
    fi
    
    if ! podman machine ls --format "{{.Running}}" | grep -q "true"; then
        echo "🔌 Starting Podman machine..."
        podman machine start
    else
        echo "✅ Podman machine is running"
    fi
    echo ""
fi

# Check for podman-compose
if ! command -v podman-compose &> /dev/null; then
    echo "⚠️  podman-compose is not installed"
    echo "Installing podman-compose with pip..."
    pip install podman-compose
    echo "✅ podman-compose installed"
    echo ""
fi

echo "📦 podman-compose: $(podman-compose --version)"
echo ""

# Create networks
echo "🔗 Setting up networks..."
if ! podman network inspect remi-network &> /dev/null; then
    podman network create remi-network
    echo "✅ Created remi-network"
else
    echo "✅ remi-network already exists"
fi
echo ""

# Build images
echo "🏗️  Building Docker images with Podman..."
echo ""

echo "📦 Building backend image..."
podman build -t remi-backend:latest remi-backend/
echo "✅ Backend image built"
echo ""

echo "📦 Building frontend image..."
podman build -t remi-frontend:latest remi/remi/
echo "✅ Frontend image built"
echo ""

# Display next steps
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo ""
echo "Option 1: Use podman-compose (Recommended)"
echo "  podman-compose -f docker-compose.yml up -d"
echo ""
echo "Option 2: Run containers manually"
echo ""
echo "  Backend:"
echo "    podman run -d --name remi-backend --network remi-network \\"
echo "      -p 3100:3100 \\"
echo "      -e OPENAI_API_KEY=your_key \\"
echo "      -e LOG_LEVEL=info \\"
echo "      remi-backend:latest"
echo ""
echo "  Frontend:"
echo "    podman run -d --name remi-frontend --network remi-network \\"
echo "      -p 3000:3000 \\"
echo "      -e VITE_API_URL=http://remi-backend:3100 \\"
echo "      remi-frontend:latest"
echo ""
echo "🔗 Access the app:"
echo "  Frontend: http://localhost:3000"
echo "  Backend: http://localhost:3100"
echo "  Health: http://localhost:3100/health"
echo ""
echo "📚 For more info, see: PODMAN_SETUP.md"
echo ""
