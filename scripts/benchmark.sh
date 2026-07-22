#!/bin/bash
# ClickHouse scale benchmark: loads N synthetic spans into an isolated `bench`
# org and times the exact aggregations the dashboard runs.
#
# Usage:   ./scripts/benchmark.sh [N]        # default 50,000,000 spans
#          ./scripts/benchmark.sh clean      # drop all bench partitions
#
# Data layout: 100 spans/session, 5 agents, 3 versions, ~33% LLM spans with
# token counts, 2% error spans, spread over 2026-05-01..2026-05-30 so the bench
# rows get their OWN daily partitions (droppable in one ALTER each) and sit
# safely inside the table's 180-day TTL.
#
# Results (2026-07-10, single dev box — Postgres+ClickHouse+backend all local,
# 36.7M spans / 367k sessions, 3 warm runs each). Two schema generations
# measured on IDENTICAL data:
#
#                                    Map-expression queries   MATERIALIZED columns
#   point lookup (1 session by id)          0.08s                  0.016s
#   sessions list (group 367k)              3.0s                   0.52s
#   analytics totals (full scan+p95)        3.7s                   0.63s
#   daily time series (30 buckets)          2.5s                   —
#   version comparison (3 cohorts)          4.2s                   0.83s
#
# The win comes from OrgId/SessionId/Model/token counts being MATERIALIZED
# columns (computed once at insert) so aggregates never decompress the Map
# columns — SpanAttributes carries full prompts, and reading it per-row was
# the dominant cost. Queries below use the materialized columns, matching
# what ClickHouseRepository actually runs. Next lever if aggregates ever get
# slow again: read the remi_session_rollup MV instead of otel_traces.
set -euo pipefail

CH="docker exec -i clickhouse clickhouse-client --user remi_user --password remi_password --database remi"

if [ "${1:-}" = "clean" ]; then
  for d in $($CH -q "SELECT DISTINCT partition FROM system.parts WHERE table='otel_traces' AND active AND partition LIKE '2026-05-%'"); do
    echo "dropping partition $d"
    $CH -q "ALTER TABLE otel_traces DROP PARTITION '$d'"
  done
  exit 0
fi

N="${1:-50000000}"
echo "== Inserting $N synthetic spans into org 'bench' =="
time $CH --max_insert_threads 4 -q "
INSERT INTO otel_traces
    (Timestamp, TraceId, SpanId, ParentSpanId, TraceState, SpanName, SpanKind,
     ServiceName, ResourceAttributes, ScopeName, ScopeVersion, SpanAttributes,
     Duration, StatusCode, StatusMessage)
SELECT
    toDateTime64('2026-05-01 00:00:00', 9) + toIntervalSecond(number % 2592000) AS Timestamp,
    lower(hex(sipHash128(intDiv(number, 100))))                                 AS TraceId,
    lower(hex(sipHash64(number)))                                               AS SpanId,
    if(number % 100 = 0, '', lower(hex(sipHash64(intDiv(number, 100) * 100))))  AS ParentSpanId,
    ''                                                                          AS TraceState,
    if(number % 3 = 0, 'ChatOpenAI.chat', concat('execute_tool tool_', toString(number % 8))) AS SpanName,
    if(number % 3 = 0, 'SPAN_KIND_INTERNAL', 'SPAN_KIND_CLIENT')                AS SpanKind,
    concat('bench-agent-', toString(number % 5))                                AS ServiceName,
    map('remi.org_id', 'bench',
        'service.name', concat('bench-agent-', toString(number % 5)),
        'service.version', concat('1.', toString(number % 3), '.0'))            AS ResourceAttributes,
    'bench' AS ScopeName, '1' AS ScopeVersion,
    if(number % 3 = 0,
       map('remi.session_id', concat('bench-', toString(intDiv(number, 100))),
           'gen_ai.request.model', 'gpt-4o-mini',
           'gen_ai.system', 'openai',
           'gen_ai.usage.input_tokens', toString(500 + number % 2000),
           'gen_ai.usage.output_tokens', toString(100 + number % 500)),
       map('remi.session_id', concat('bench-', toString(intDiv(number, 100))))) AS SpanAttributes,
    toInt64((50 + number % 5000) * 1000000)                                     AS Duration,
    if(number % 50 = 0, 'STATUS_CODE_ERROR', 'STATUS_CODE_OK')                  AS StatusCode,
    ''                                                                          AS StatusMessage
FROM numbers($N)
"

$CH -q "SELECT 'bench rows:', count() FROM otel_traces WHERE ResourceAttributes['remi.org_id'] = 'bench'"
$CH -q "SELECT 'bench size on disk:', formatReadableSize(sum(bytes_on_disk)) FROM system.parts WHERE table='otel_traces' AND active AND partition LIKE '2026-05-%'"

# The dashboard's actual query shapes, org-scoped to bench.
# Materialized columns — the same shapes ClickHouseRepository queries.
ORG="OrgId = 'bench'"
SESSION="SessionId"

run() {
  local label="$1" query="$2"
  echo
  echo "-- $label (3 runs: cold, warm, warm)"
  for i in 1 2 3; do
    $CH --time -q "$query" >/dev/null 2>/tmp/bench_time
    echo "  run $i: $(cat /tmp/bench_time)s"
  done
}

run "Sessions list page (group 100-span sessions, latest 20)" "
SELECT $SESSION AS session_id, count(), min(Timestamp), max(Timestamp),
       countIf(notEmpty(Model)),
       sum(InputTokens),
       round(avgIf(Duration/1000000, notEmpty(Model)))
FROM otel_traces WHERE $ORG
GROUP BY session_id ORDER BY max(Timestamp) DESC LIMIT 20"

run "Analytics totals (whole org, one pass)" "
SELECT count(DISTINCT $SESSION),
       countIf(notEmpty(Model)),
       sum(InputTokens),
       sum(OutputTokens),
       uniqExactIf($SESSION, StatusCode = 'STATUS_CODE_ERROR'),
       round(quantileIf(0.95)(Duration/1000000, notEmpty(Model)))
FROM otel_traces WHERE $ORG"

run "Daily time series (30 buckets)" "
SELECT toDate(Timestamp), count(DISTINCT $SESSION),
       countIf(notEmpty(Model)),
       countIf(StatusCode = 'STATUS_CODE_ERROR')
FROM otel_traces WHERE $ORG GROUP BY 1 ORDER BY 1"

run "Single session detail (100 spans by id)" "
SELECT SpanId, SpanName, Duration, StatusCode, SpanAttributes
FROM otel_traces WHERE $ORG AND $SESSION = 'bench-424242'
ORDER BY Timestamp"

run "Version comparison (3 cohorts)" "
SELECT ServiceVersion AS v, count(DISTINCT $SESSION),
       round(avgIf(Duration/1000000, notEmpty(Model))),
       round(quantileIf(0.95)(Duration/1000000, notEmpty(Model)))
FROM otel_traces WHERE $ORG GROUP BY v"

echo
echo "Done. Clean up with: ./scripts/benchmark.sh clean"
