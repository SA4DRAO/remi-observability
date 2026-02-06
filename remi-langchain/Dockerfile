# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy project metadata first for better layer caching
COPY pyproject.toml ./
COPY src ./src
COPY README.md ./

# Install runtime deps only
RUN pip install --upgrade pip && pip install .

# Default command runs CLI help
ENTRYPOINT ["python", "-m", "remi_langchain.cli"]
CMD ["--print-summary", "I love how responsive and helpful this product is!"]