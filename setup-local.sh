#!/bin/bash

# Remi Project - Local Development Setup Script
# This script sets up the entire Remi project for local development

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║        Remi Project - Local Development Setup              ║"
echo "║              AI-Powered Browser Automation                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Function to check command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to print section headers
print_section() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}▶ $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Function to print success
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

# Function to print warning
print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Function to print error
print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
print_section "Checking Prerequisites"

if ! command_exists node; then
    print_error "Node.js is not installed"
    echo "Please install Node.js 20+ from https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node --version)
print_success "Node.js ${NODE_VERSION#v} is installed"

if ! command_exists npm; then
    print_error "npm is not installed"
    exit 1
fi
NPM_VERSION=$(npm --version)
print_success "npm ${NPM_VERSION} is installed"

# Check for Chromium/Chrome
print_section "Checking Browser Installation"

BROWSER_PATH=""
if command_exists chromium; then
    BROWSER_PATH=$(command -v chromium)
    print_success "Chromium found at: $BROWSER_PATH"
elif command_exists chromium-browser; then
    BROWSER_PATH=$(command -v chromium-browser)
    print_success "Chromium found at: $BROWSER_PATH"
elif command_exists google-chrome; then
    BROWSER_PATH=$(command -v google-chrome)
    print_success "Google Chrome found at: $BROWSER_PATH"
elif command_exists google-chrome-stable; then
    BROWSER_PATH=$(command -v google-chrome-stable)
    print_success "Google Chrome found at: $BROWSER_PATH"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    if [[ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
        BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        print_success "Google Chrome found at: $BROWSER_PATH"
    elif [[ -f "/Applications/Chromium.app/Contents/MacOS/Chromium" ]]; then
        BROWSER_PATH="/Applications/Chromium.app/Contents/MacOS/Chromium"
        print_success "Chromium found at: $BROWSER_PATH"
    fi
fi

if [[ -z "$BROWSER_PATH" ]]; then
    print_warning "Chrome/Chromium not found. You'll need to install it."
    print_warning "macOS: brew install google-chrome  OR  brew install chromium"
    print_warning "Ubuntu: sudo apt-get install chromium-browser  OR  google-chrome-stable"
    print_warning "You can set BROWSER_EXECUTABLE_PATH in .env after setup"
    BROWSER_PATH=""
fi

echo ""

# Setup Backend
print_section "Setting Up Backend"

if [[ ! -d "remi-backend" ]]; then
    print_error "remi-backend directory not found"
    echo "Make sure you're in the project root directory"
    exit 1
fi

cd remi-backend
print_success "In backend directory"

# Check if node_modules exists
if [[ ! -d "node_modules" ]]; then
    echo "📦 Installing backend dependencies (this may take a minute)..."
    npm install
    print_success "Backend dependencies installed"
else
    print_success "Backend dependencies already installed"
fi

# Create .env file
print_success "Creating backend .env file"

cat > .env << EOF
# ═══════════════════════════════════════════════════════════
# Remi Backend - Local Development Environment
# ═══════════════════════════════════════════════════════════

# Server Configuration
NODE_ENV=development
PORT=3100
HOST=0.0.0.0

# OpenAI Configuration
# Get your API key from: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk_test_your_api_key_here

# Browser Configuration
BROWSER_HEADLESS=true
BROWSER_TIMEOUT=15000
BROWSER_SANDBOX=false
EOF

# Add browser executable path if found
if [[ -n "$BROWSER_PATH" ]]; then
    echo "BROWSER_EXECUTABLE_PATH=$BROWSER_PATH" >> .env
fi

cat >> .env << EOF

# CORS Configuration (allows requests from frontend)
CORS_ORIGINS=http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173

# Logging
LOG_LEVEL=debug

# ═══════════════════════════════════════════════════════════
# NOTE: Update OPENAI_API_KEY with your actual API key!
# Get it from: https://platform.openai.com/api-keys
# ═══════════════════════════════════════════════════════════
EOF

print_success "Backend .env file created"
echo "  📝 Location: remi-backend/.env"
echo "  ⚠️  TODO: Add your OPENAI_API_KEY (get from https://platform.openai.com/api-keys)"

echo ""

# Back to root
cd ..

# Setup Frontend
print_section "Setting Up Frontend"

if [[ ! -d "remi/remi" ]]; then
    print_error "remi/remi directory not found"
    echo "Make sure you're in the project root directory"
    exit 1
fi

cd remi/remi
print_success "In frontend directory"

# Check if node_modules exists
if [[ ! -d "node_modules" ]]; then
    echo "📦 Installing frontend dependencies (this may take a minute)..."
    npm install
    print_success "Frontend dependencies installed"
else
    print_success "Frontend dependencies already installed"
fi

# Create .env file
print_success "Creating frontend .env file"

cat > .env.development << EOF
# ═══════════════════════════════════════════════════════════
# Remi Frontend - Local Development Environment
# ═══════════════════════════════════════════════════════════

# API Configuration
# Backend is running on http://localhost:3100
VITE_API_URL=http://localhost:3100
VITE_API_TIMEOUT=30000

# Environment
VITE_ENV=development

# Feature Flags
# Enable debug logging in development
VITE_ENABLE_DEBUG=true

# ═══════════════════════════════════════════════════════════
EOF

print_success "Frontend .env file created"
echo "  📝 Location: remi/remi/.env.development"

echo ""

# Back to root
cd ../..

# Summary
print_section "Setup Complete! 🎉"

echo ""
echo -e "${GREEN}All components are ready for local development!${NC}"
echo ""
echo -e "${BLUE}📋 Next Steps:${NC}"
echo ""
echo "1. ${YELLOW}Configure OpenAI API Key${NC}"
echo "   Edit: ${YELLOW}remi-backend/.env${NC}"
echo "   Add your API key from: https://platform.openai.com/api-keys"
echo ""
echo "2. ${YELLOW}Start Backend (Terminal 1)${NC}"
echo "   ${BLUE}cd remi-backend${NC}"
echo "   ${BLUE}npm run dev${NC}"
echo "   Backend runs on: http://localhost:3100"
echo ""
echo "3. ${YELLOW}Start Frontend (Terminal 2)${NC}"
echo "   ${BLUE}cd remi/remi${NC}"
echo "   ${BLUE}npm run dev${NC}"
echo "   Frontend runs on: http://localhost:5173"
echo ""
echo "4. ${YELLOW}Open in Browser${NC}"
echo "   ${BLUE}http://localhost:5173${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}📚 Useful Commands:${NC}"
echo ""
echo "Backend:"
echo "  ${BLUE}npm run dev${NC}              - Start with auto-reload"
echo "  ${BLUE}npm run build${NC}            - Build TypeScript"
echo "  ${BLUE}npm run lint${NC}             - Check code quality"
echo "  ${BLUE}npm start${NC}                - Run production build"
echo ""
echo "Frontend:"
echo "  ${BLUE}npm run dev${NC}              - Start dev server on port 5173"
echo "  ${BLUE}npm run build${NC}            - Build for production"
echo "  ${BLUE}npm run preview${NC}          - Preview production build"
echo "  ${BLUE}npm run lint${NC}             - Check code quality"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}🔍 Check Status:${NC}"
echo ""
echo "  Backend Health:"
echo "    ${BLUE}curl http://localhost:3100/health${NC}"
echo ""
echo "  Backend Info:"
echo "    ${BLUE}curl http://localhost:3100/info${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}📖 Documentation:${NC}"
echo "  Backend: ${YELLOW}remi-backend/README.md${NC}"
echo "  Frontend: ${YELLOW}remi/README_NEW.md${NC}"
echo "  Architecture: ${YELLOW}remi/ARCHITECTURE.md${NC}"
echo "  Chromium Help: ${YELLOW}remi-backend/CHROMIUM_SETUP.md${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}Happy coding! 🚀${NC}"
echo ""
