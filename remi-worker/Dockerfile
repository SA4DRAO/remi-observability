FROM python:3.11-slim AS builder

WORKDIR /build

# Copy only the packaging metadata first so this layer is cached unless deps change
COPY pyproject.toml ./
COPY src/ ./src/

# Install into a venv so ALL deps (including transitive ones) land in one tree
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir .

# ── Runtime image ────────────────────────────────────────────────────────────
FROM python:3.11-slim

LABEL maintainer="Remi Team"
LABEL description="Remi Background Worker – Kafka consumer for event processing"

WORKDIR /app

# Install runtime system dep (curl for healthcheck probes)
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Copy the venv from builder — all deps including transitive ones are here
COPY --from=builder /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Copy source so the installed package can import remi_worker
COPY src/ ./src/

# Backwards-compatible shim (kept so `docker exec ... python main.py` still works)
COPY main.py ./

CMD ["python", "-m", "remi_worker"]

