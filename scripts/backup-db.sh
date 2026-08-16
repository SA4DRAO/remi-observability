#!/usr/bin/env bash
# Postgres backup + restore verification.
#
# Postgres holds the only irreplaceable data in the stack: api_keys (lose it and
# every customer's agents stop reporting), org_members, and the audit chain.
# ClickHouse spans are large, replaceable, and already TTL'd at 180 days.
#
#   ./scripts/backup-db.sh            # dump, verify it restores, prune old ones
#   BACKUP_DIR=/mnt/x ./scripts/backup-db.sh
#
# Daily via host cron:
#   0 4 * * * cd /path/to/Remi && ./scripts/backup-db.sh >> backups/backup.log 2>&1
#
# ponytail: dumps land on the same box as the database, so this covers operator
# error and container loss — NOT losing the machine. Ship BACKUP_DIR to object
# storage (or move to managed Postgres) before that distinction costs you.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
KEEP="${KEEP:-7}"
PGUSER="${POSTGRES_USER:-remi_user}"
PGDB="${POSTGRES_DB:-remi_db}"
CONTAINER="${PG_CONTAINER:-postgres-primary}"
VERIFY_DB="remi_verify_$$"

# Tables whose row counts must survive the round trip. If a dump restores with
# fewer api_keys than the source, the backup is worthless and we want to know now.
TABLES=(orgs api_keys org_members audit_log pii_policies)

psql_q() { docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$1" -tAc "$2"; }

mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="$BACKUP_DIR/remi-$stamp.sql.gz"

echo "→ dumping $PGDB"
docker exec -i "$CONTAINER" pg_dump -U "$PGUSER" -d "$PGDB" | gzip >"$dump"
echo "  wrote $dump ($(du -h "$dump" | cut -f1))"

# A backup nobody has restored is a guess. Restore into a scratch database and
# compare row counts before trusting it.
echo "→ verifying restore into $VERIFY_DB"
cleanup() { docker exec -i "$CONTAINER" dropdb -U "$PGUSER" --if-exists "$VERIFY_DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker exec -i "$CONTAINER" createdb -U "$PGUSER" "$VERIFY_DB"
# ON_ERROR_STOP is load-bearing: psql exits 0 after failed statements without it,
# so a truncated dump would "restore successfully" into a half-empty database.
if ! gunzip -c "$dump" | docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$VERIFY_DB" -q -v ON_ERROR_STOP=1 >/dev/null; then
	echo "  RESTORE FAILED — $dump is not usable" >&2
	exit 1
fi

fail=0
for t in "${TABLES[@]}"; do
	src=$(psql_q "$PGDB" "SELECT count(*) FROM $t" 2>/dev/null || echo missing)
	dst=$(psql_q "$VERIFY_DB" "SELECT count(*) FROM $t" 2>/dev/null || echo missing)
	if [ "$src" = "$dst" ] && [ "$src" != "missing" ]; then
		printf '  ok    %-14s %s rows\n' "$t" "$src"
	else
		printf '  FAIL  %-14s source=%s restored=%s\n' "$t" "$src" "$dst"
		fail=1
	fi
done

if [ "$fail" != 0 ]; then
	echo "verification failed — keeping $dump for inspection, do not rely on it" >&2
	exit 1
fi

# Prune only after a dump has verified, so a run of bad backups can never
# age out the last known-good one.
ls -1t "$BACKUP_DIR"/remi-*.sql.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
	echo "  pruning $(basename "$old")"
	rm -f "$old"
done

echo "backup verified: $dump"
