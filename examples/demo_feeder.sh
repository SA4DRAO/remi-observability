#!/bin/sh
# Keeps the public demo org populated: runs one example agent, sleeps, repeats.
# Alternates service.version between cycles so the version-comparison view has
# two cohorts to show. Requires OPENROUTER_API_KEY (or OPENAI_API_KEY) and
# REMI_INGEST_KEY from the environment.
#
# The agents are fully isolated production-style files: zero telemetry code,
# zero Remi imports. ALL wiring happens here via env vars — OTLP export through
# `opentelemetry-instrument`, and LLM provider via plain OPENAI_* vars
# (OpenRouter is just an OpenAI-compatible base_url + prefixed model name).

# LLM provider: route via OpenRouter when its key is set, else direct OpenAI.
if [ -n "$OPENROUTER_API_KEY" ]; then
  export OPENAI_API_KEY="$OPENROUTER_API_KEY"
  export OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://openrouter.ai/api/v1}"
  export OPENAI_MODEL="${OPENAI_MODEL:-openai/gpt-4o-mini}"
fi

AGENTS="customer_support_agent.py:support-agent research_agent.py:research-agent simple_chain_agent.py:simple-chain-agent code_review_agent.py:code-review-agent multi_agent_supervisor.py:supervisor-agent"
INTERVAL="${FEED_INTERVAL:-900}"
VERSION_A="${FEED_VERSION_A:-1.2.0}"
VERSION_B="${FEED_VERSION_B:-1.3.0}"

export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=none
export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://backend:3100}"
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${REMI_INGEST_KEY:-demo-ingest-key}"
export OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=os,process,host
export OTEL_METRIC_EXPORT_INTERVAL=5000

cycle=0

while true; do
  if [ $((cycle % 2)) -eq 0 ]; then
    VERSION="$VERSION_A"
  else
    VERSION="$VERSION_B"
  fi
  export OTEL_RESOURCE_ATTRIBUTES="service.namespace=${REMI_ORG_ID:-demo-org},service.version=${VERSION}"

  for pair in $AGENTS; do
    agent="${pair%%:*}"
    service_name="${pair##*:}"
    export OTEL_SERVICE_NAME="$service_name"
    echo "[feeder] cycle=$cycle version=$VERSION service=$service_name running $agent"
    opentelemetry-instrument python "$agent" || echo "[feeder] $agent failed (continuing)"
    sleep "$INTERVAL"
  done
  cycle=$((cycle + 1))
done
