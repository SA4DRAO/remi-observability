# Podman Setup Guide

This guide helps you use Podman instead of Docker with the Remi project.

## What is Podman?

Podman is a daemonless, open-source container engine that:
- ✅ Is OCI-compliant (same containers as Docker)
- ✅ Doesn't require root daemon
- ✅ Works with same image formats
- ✅ Can run Docker containers
- ✅ Compatible with docker-compose

## Installation

### macOS
```bash
brew install podman

# Start Podman machine
podman machine init
podman machine start

# Verify
podman --version
```

### Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install podman

# Verify
podman --version
```

### Fedora
```bash
sudo dnf install podman

# Verify
podman --version
```

### Windows (WSL2)
```bash
# Inside WSL2 terminal
sudo apt-get update
sudo apt-get install podman

# Verify
podman --version
```

## Using Podman with Remi

### Option 1: Direct Podman Commands

**Build Backend:**
```bash
cd remi-backend
podman build -t remi-backend .
podman run -p 3100:3100 \
  -e OPENAI_API_KEY=your_key_here \
  -e LOG_LEVEL=debug \
  remi-backend
```

**Build Frontend:**
```bash
cd remi
podman build -t remi-frontend .
podman run -p 3000:3000 \
  -e VITE_API_URL=http://localhost:3100 \
  remi-frontend
```

### Option 2: Use podman-compose (Recommended)

Install podman-compose:
```bash
# macOS
brew install podman-compose

# Ubuntu/Debian
pip install podman-compose

# Or
sudo pip3 install podman-compose

# Verify
podman-compose --version
```

Then use same commands as Docker:
```bash
# From project root
podman-compose up --build

# View logs
podman-compose logs -f

# Stop services
podman-compose down
```

### Option 3: Use Docker Compose with Podman

If you have Docker Compose v2+ installed but not the Docker daemon:

```bash
# Configure Podman socket
export DOCKER_HOST=unix:///run/podman/podman.sock

# Now use docker-compose normally
docker-compose up --build
```

## Podman Commands Cheat Sheet

### Container Management
```bash
# List images
podman images

# List running containers
podman ps

# List all containers
podman ps -a

# Build image
podman build -t name:tag .

# Run container
podman run -p hostport:containerport image

# Stop container
podman stop container-id

# Remove container
podman rm container-id

# View logs
podman logs container-id
podman logs -f container-id  # Follow logs
```

### Network
```bash
# Create network
podman network create remi-network

# Run on network
podman run --network remi-network --name backend remi-backend
podman run --network remi-network -e API_URL=http://backend:3100 remi-frontend

# Inspect network
podman network ls
podman network inspect remi-network
```

### Volume Management
```bash
# Create volume
podman volume create my-volume

# Run with volume
podman run -v my-volume:/data image

# List volumes
podman volume ls

# Inspect volume
podman volume inspect my-volume

# Remove volume
podman volume rm my-volume
```

## Troubleshooting

### "Cannot connect to Podman socket"

On macOS, start the Podman machine:
```bash
podman machine ls
podman machine start
```

### "Permission denied"

On Linux, add your user to podman group:
```bash
sudo usermod -aG podman $USER
newgrp podman
```

### "Podman not found"

Verify installation:
```bash
which podman
podman --version
```

Reinstall if needed:
```bash
# macOS
brew reinstall podman

# Ubuntu/Debian
sudo apt-get reinstall podman
```

### Container can't reach other containers

Make sure containers are on the same network:
```bash
# Create network
podman network create remi-network

# Run both containers with --network flag
podman run --network remi-network backend
podman run --network remi-network frontend
```

## Podman vs Docker Commands

| Task | Docker | Podman |
|------|--------|--------|
| Build image | `docker build` | `podman build` |
| Run container | `docker run` | `podman run` |
| List images | `docker images` | `podman images` |
| View logs | `docker logs` | `podman logs` |
| Stop container | `docker stop` | `podman stop` |
| Remove image | `docker rmi` | `podman rmi` |
| Use compose | `docker-compose` | `podman-compose` |

## Running Remi with Podman

### Quick Start

1. **Install podman and podman-compose:**
   ```bash
   # macOS
   brew install podman podman-compose
   
   # Linux
   sudo apt-get install podman
   pip install podman-compose
   ```

2. **Start Podman (if using machine):**
   ```bash
   podman machine start
   ```

3. **Run entire stack:**
   ```bash
   podman-compose up --build
   ```

4. **Access services:**
   - Frontend: http://localhost:3000
   - Backend: http://localhost:3100
   - Health: http://localhost:3100/health

### Full Manual Setup

**Terminal 1 - Backend:**
```bash
cd remi-backend
podman build -t remi-backend .
podman run \
  --name remi-backend \
  -p 3100:3100 \
  -e OPENAI_API_KEY=your_key \
  -e BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
  -e LOG_LEVEL=debug \
  remi-backend
```

**Terminal 2 - Frontend:**
```bash
cd remi
podman build -t remi-frontend .
podman run \
  --name remi-frontend \
  -p 3000:3000 \
  -e VITE_API_URL=http://localhost:3100 \
  remi-frontend
```

## Podman Tips & Best Practices

1. **Use rootless mode** (default on newer versions)
   - Runs without root privileges
   - Better security
   - More efficient

2. **Name your containers**
   ```bash
   podman run --name my-app image
   ```

3. **Use networks for multi-container apps**
   ```bash
   podman network create myapp
   podman run --network myapp --name backend backend-image
   podman run --network myapp -e API=http://backend:3100 frontend-image
   ```

4. **Use volumes for persistence**
   ```bash
   podman volume create mydata
   podman run -v mydata:/data image
   ```

5. **Check resource usage**
   ```bash
   podman stats
   ```

6. **Keep images clean**
   ```bash
   podman system prune -a  # Remove unused images/containers
   ```

## Advanced Usage

### Pod Mode (Group related containers)

```bash
# Create a pod
podman pod create -n remi-app -p 3000:3000 -p 3100:3100

# Run containers in the pod
podman run --pod remi-app --name backend remi-backend
podman run --pod remi-app --name frontend remi-frontend

# View pod status
podman pod ps
podman pod inspect remi-app
```

### Rootless Podman

```bash
# Check if running rootless
podman info | grep rootless

# Most modern Linux systems run rootless by default
# On macOS/Windows, Podman machine always runs rootless
```

### Building Multi-Stage Images

Both Dockerfiles work with Podman:
```bash
podman build -t remi-frontend -f remi/Dockerfile remi/
```

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Container can't access network | Create and use podman network |
| Port conflicts | Use different port: `podman run -p 3101:3100` |
| Out of disk space | `podman system prune` |
| Need more resources | Check `podman machine set --cpus` |
| Cannot write to volume | Check file permissions |

---

**That's it! Podman is a drop-in replacement for Docker.** 🎉

For more info: https://podman.io/docs/
