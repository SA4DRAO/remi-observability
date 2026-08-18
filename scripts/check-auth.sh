#!/usr/bin/env bash
# Auth boundary check. Runs against the backend DIRECTLY (bypassing Caddy) —
# that is the point: it proves a forged X-Forwarded-Email is rejected by the
# backend itself, not merely stripped by the proxy in front of it.
#
#   PROXY_SHARED_SECRET=<secret> ./scripts/check-auth.sh [url]
#
# The backend must be running with the same PROXY_SHARED_SECRET.
set -uo pipefail

URL="${1:-http://localhost:3100}"
SECRET="${PROXY_SHARED_SECRET:-}"
MEMBER="${MEMBER_EMAIL:?set MEMBER_EMAIL to a seeded org_members email}"
KEY="${REMI_API_KEY:-acme-admin-key}"
ENDPOINT="/api/v1/sessions?limit=1"

if [ -z "$SECRET" ]; then
	echo "PROXY_SHARED_SECRET is unset — the backend would reject every proxy user." >&2
	exit 2
fi

fail=0
check() { # check <expected-status> <description> <curl args...>
	local expected="$1" desc="$2"; shift 2
	local got
	got=$(curl -s -o /dev/null -w '%{http_code}' "$@")
	if [ "$got" = "$expected" ]; then
		printf '  ok    %s (%s)\n' "$desc" "$got"
	else
		printf '  FAIL  %s — expected %s, got %s\n' "$desc" "$expected" "$got"
		fail=1
	fi
}

echo "Checking auth boundary at $URL"

check 401 "no credentials rejected" "$URL$ENDPOINT"

check 401 "forged email without the proxy secret rejected" \
	-H "X-Forwarded-Email: $MEMBER" "$URL$ENDPOINT"

check 401 "forged email with a wrong proxy secret rejected" \
	-H "X-Forwarded-Email: $MEMBER" -H "X-Remi-Proxy-Secret: not-the-secret" "$URL$ENDPOINT"

check 401 "unknown email with a valid proxy secret rejected" \
	-H "X-Forwarded-Email: nobody@example.com" -H "X-Remi-Proxy-Secret: $SECRET" "$URL$ENDPOINT"

check 200 "org member with a valid proxy secret admitted" \
	-H "X-Forwarded-Email: $MEMBER" -H "X-Remi-Proxy-Secret: $SECRET" "$URL$ENDPOINT"

check 200 "bearer API key still works" \
	-H "Authorization: Bearer $KEY" "$URL$ENDPOINT"

check 401 "bogus bearer key rejected" \
	-H "Authorization: Bearer nope" "$URL$ENDPOINT"

check 404 "cross-tenant org listing is gone" \
	-H "Authorization: Bearer $KEY" "$URL/api/v1/admin/orgs"

# 5MB against the 4MB ingest cap. Refused without ever reaching the collector.
head -c 5242880 /dev/zero >"${TMPDIR:-/tmp}/remi-oversized.bin"
check 413 "oversized ingest payload refused" \
	-X POST -H "Authorization: Bearer $KEY" \
	-H "Content-Type: application/x-protobuf" \
	--data-binary "@${TMPDIR:-/tmp}/remi-oversized.bin" "$URL/v1/traces"
rm -f "${TMPDIR:-/tmp}/remi-oversized.bin"

[ "$fail" = 0 ] && echo "all checks passed" || echo "FAILURES — do not deploy"
exit "$fail"
