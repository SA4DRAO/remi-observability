#!/usr/bin/env bash
# Audit-chain anchoring: record each org's chain head off-box, and check the
# previously recorded head still matches.
#
# The hash chain in audit_log proves nobody edited a row *using the app*. It
# proves nothing against anyone with write access to Postgres: drop the
# immutability trigger, rewrite the rows, recompute every entry_hash forward,
# and the chain verifies clean. What closes that hole is a copy of the chain
# head held somewhere the database admin cannot reach.
#
#   ./scripts/anchor-audit.sh
#   AUDIT_ANCHOR_WEBHOOK=https://... ./scripts/anchor-audit.sh   # off-box copy
#
# Daily via host cron (before the backup, so a tampered chain is caught while
# yesterday's dump is still on disk):
#   0 3 * * * cd /path/to/Remi && ./scripts/anchor-audit.sh >> anchors/anchor.log 2>&1
#
# Exit 2 = a recorded head no longer matches the database. That is history
# rewritten after the fact; investigate before restoring anything over it.
#
# ponytail: the local ledger sits on the same box as the database, so on its own
# it only raises the cost of tampering. AUDIT_ANCHOR_WEBHOOK is what makes it
# evidence — point it at anything append-only the DB operator does not control
# (S3 Object Lock bucket, a customer's endpoint, an inbox).
set -euo pipefail

ANCHOR_DIR="${ANCHOR_DIR:-$(cd "$(dirname "$0")/.." && pwd)/anchors}"
LEDGER="$ANCHOR_DIR/audit-anchors.tsv"
PGUSER="${POSTGRES_USER:-remi_user}"
PGDB="${POSTGRES_DB:-remi_db}"
CONTAINER="${PG_CONTAINER:-postgres-primary}"
WEBHOOK="${AUDIT_ANCHOR_WEBHOOK:-}"

# No -i: this runs inside a `while read` loop, and an interactive docker exec
# would swallow the loop's stdin along with every org after the first.
psql_q() { docker exec "$CONTAINER" psql -U "$PGUSER" -d "$PGDB" -tAF$'\t' -c "$1"; }

if [ "${1:-}" = "--self-test" ]; then
    # Copies audit_log into a scratch database, tampers with it three ways, and
    # asserts each one is caught. Runs against the live stack — there is no test
    # suite in this repo, so this script is its own.
    tdb="remi_anchor_selftest_$$"
    x() { docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$1" -tAc "$2" >/dev/null; }
    trap 'x postgres "DROP DATABASE IF EXISTS $tdb"; rm -rf "${tmp:-/nonexistent}"' EXIT
    x postgres "CREATE DATABASE $tdb"
    docker exec -i "$CONTAINER" pg_dump -U "$PGUSER" -d "$PGDB" -t audit_log \
        | docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$tdb" >/dev/null 2>&1
    # The immutability triggers are exactly what an attacker drops first.
    x "$tdb" "SET client_min_messages = warning;
              DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
              DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
              CREATE EXTENSION IF NOT EXISTS pgcrypto"
    org=$(docker exec "$CONTAINER" psql -U "$PGUSER" -d "$tdb" -tAc \
        "SELECT org_id FROM audit_log WHERE entry_hash IS NOT NULL
         GROUP BY org_id ORDER BY count(*) DESC LIMIT 1")
    [ -n "$org" ] || { echo "self-test SKIP: no chained audit entries to work with"; exit 0; }
    tmp=$(mktemp -d)
    run() { POSTGRES_DB="$tdb" ANCHOR_DIR="$tmp" AUDIT_ANCHOR_WEBHOOK= "$0"; }
    assert() { [ "$1" = "$2" ] || { echo "self-test FAIL: $3 (exit $1, want $2)"; exit 1; }; }

    run >/dev/null; assert $? 0 "baseline anchor"
    run >/dev/null; assert $? 0 "unchanged chain must stay clean"

    # 1. Edit a row and relink+rehash the whole org chain, so it still passes
    #    /admin/audit-log/verify. Only the recorded head hash gives it away.
    x "$tdb" "DO \$\$
        DECLARE r RECORD; p TEXT := 'genesis'; BEGIN
          UPDATE audit_log SET action='benign'
           WHERE id = (SELECT max(id) - 1 FROM audit_log WHERE org_id='$org' AND entry_hash IS NOT NULL);
          FOR r IN SELECT * FROM audit_log WHERE org_id='$org' AND entry_hash IS NOT NULL ORDER BY id LOOP
            UPDATE audit_log SET prev_hash = p, entry_hash = encode(digest(
              p||'|'||org_id||'|'||coalesce(actor_key_id,'')||'|'||action||'|'||coalesce(resource_type,'')
              ||'|'||coalesce(resource_id,'')||'|'||to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US'),
              'sha256'),'hex') WHERE id = r.id RETURNING entry_hash INTO p;
          END LOOP;
        END \$\$;"
    set +e; out=$(run); rc=$?; set -e
    assert $rc 2 "relinked chain rewrite must be caught"
    echo "$out" | grep -q "^TAMPERED $org" || { echo "self-test FAIL: no TAMPERED line for $org"; exit 1; }

    # 2. Delete a row below the head. Every surviving hash is untouched, so only
    #    the entry count catches this one.
    rm -rf "$tmp"; mkdir -p "$tmp"
    run >/dev/null
    x "$tdb" "DELETE FROM audit_log
               WHERE id = (SELECT min(id) FROM audit_log WHERE org_id='$org' AND entry_hash IS NOT NULL)"
    set +e; run >/dev/null; rc=$?; set -e
    assert $rc 2 "mid-chain deletion must be caught by the entry count"

    echo "self-test PASS (org $org): rewrite and deletion both detected"
    exit 0
fi

mkdir -p "$ANCHOR_DIR"
touch "$LEDGER"
stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tampered=0

# Current head per org: last chained row, plus how many chained rows precede it.
# The count matters — without it, deleting a row below the head goes unnoticed.
heads=$(psql_q "
    SELECT DISTINCT ON (org_id) org_id, id, entry_hash,
           (SELECT count(*) FROM audit_log a
             WHERE a.org_id = audit_log.org_id AND a.entry_hash IS NOT NULL
               AND a.id <= audit_log.id)
    FROM audit_log
    WHERE entry_hash IS NOT NULL
    ORDER BY org_id, id DESC")

[ -n "$heads" ] || { echo "no chained audit entries yet"; exit 0; }

while IFS=$'\t' read -r org head_id head_hash entries; do
    [ -n "$org" ] || continue

    # Check the last anchor we recorded for this org still holds.
    prev=$(awk -F'\t' -v o="$org" '$2 == o { line = $0 } END { print line }' "$LEDGER")
    if [ -n "$prev" ]; then
        IFS=$'\t' read -r p_ts _ p_entries p_id p_hash <<<"$prev"
        now=$(psql_q "
            SELECT coalesce((SELECT entry_hash FROM audit_log
                              WHERE org_id = '$org' AND id = $p_id), '<missing>'),
                   (SELECT count(*) FROM audit_log
                     WHERE org_id = '$org' AND entry_hash IS NOT NULL AND id <= $p_id)")
        IFS=$'\t' read -r now_hash now_entries <<<"$now"
        if [ "$now_hash" != "$p_hash" ] || [ "$now_entries" != "$p_entries" ]; then
            echo "TAMPERED $org: anchor from $p_ts (id $p_id, $p_entries entries) now reads" \
                 "hash ${now_hash:0:16}… / $now_entries entries, expected ${p_hash:0:16}…"
            tampered=1
            continue          # do not overwrite the good anchor with the bad head
        fi
        # Chains only grow. A head that went backwards is a truncation.
        if [ "$head_id" -lt "$p_id" ]; then
            echo "TAMPERED $org: head went backwards, $p_id → $head_id"
            tampered=1
            continue
        fi
    fi

    printf '%s\t%s\t%s\t%s\t%s\n' "$stamp" "$org" "$entries" "$head_id" "$head_hash" >>"$LEDGER"
    echo "anchored $org: id $head_id, $entries entries, ${head_hash:0:16}…"

    if [ -n "$WEBHOOK" ]; then
        body=$(jq -nc --arg ts "$stamp" --arg org "$org" --arg h "$head_hash" \
                      --argjson id "$head_id" --argjson n "$entries" \
                      '{ts:$ts, org:$org, entries:$n, head_id:$id, head_hash:$h}')
        curl -fsS -m 15 -X POST -H 'Content-Type: application/json' -d "$body" "$WEBHOOK" >/dev/null \
            || echo "  WARN: webhook POST failed — this run is not anchored off-box"
    fi
done <<<"$heads"

[ -z "$WEBHOOK" ] && echo "note: AUDIT_ANCHOR_WEBHOOK unset — ledger is local only"
exit $(( tampered ? 2 : 0 ))
