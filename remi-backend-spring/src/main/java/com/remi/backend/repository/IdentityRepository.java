package com.remi.backend.repository;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Postgres identity layer: orgs, api_keys, audit_log, pii_policies. */
@Repository
public class IdentityRepository {

    private final NamedParameterJdbcTemplate jdbc;
    private final com.fasterxml.jackson.databind.ObjectMapper mapper =
            new com.fasterxml.jackson.databind.ObjectMapper();

    public IdentityRepository(@Qualifier("identity") NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** JDBC returns PgArray/PGobject for TEXT[]/JSONB — convert so Jackson serializes cleanly. */
    private List<Map<String, Object>> normalizeRows(List<Map<String, Object>> rows) {
        for (Map<String, Object> row : rows) {
            for (var e : row.entrySet()) {
                Object v = e.getValue();
                try {
                    if (v instanceof java.sql.Array arr) {
                        e.setValue(List.of((Object[]) arr.getArray()));
                    } else if (v instanceof org.postgresql.util.PGobject pg) {
                        String val = pg.getValue();
                        e.setValue(val == null ? null : mapper.readTree(val));
                    }
                } catch (Exception ex) {
                    e.setValue(String.valueOf(v));
                }
            }
        }
        return rows;
    }

    public record ApiKeyRecord(String keyId, String orgId, List<String> scopes) {}

    public static String sha256(String raw) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(raw.getBytes()));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static List<String> scopesOf(ResultSet rs) throws SQLException {
        var arr = rs.getArray("scopes");
        if (arr == null) return List.of();
        return List.of((String[]) arr.getArray());
    }

    /** Validates a raw key: exists, not revoked, not expired. */
    public Optional<ApiKeyRecord> findByRawKey(String rawKey) {
        var params = new MapSqlParameterSource("hash", sha256(rawKey));
        List<ApiKeyRecord> rows = jdbc.query("""
                SELECT key_id, org_id, scopes
                FROM api_keys
                WHERE key_hash = :hash
                  AND revoked_at IS NULL
                  AND (expires_at IS NULL OR expires_at > NOW())
                """,
                params,
                (rs, i) -> new ApiKeyRecord(rs.getString("key_id"), rs.getString("org_id"), scopesOf(rs)));
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void touchLastUsed(String keyId) {
        jdbc.update("UPDATE api_keys SET last_used_at = NOW() WHERE key_id = :id",
                new MapSqlParameterSource("id", keyId));
    }

    // ── API keys ────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listApiKeys(String orgId) {
        return normalizeRows(jdbc.queryForList("""
                SELECT key_id, name, scopes, expires_at, last_used_at, revoked_at, created_by, created_at
                FROM api_keys WHERE org_id = :org ORDER BY created_at DESC
                """,
                new MapSqlParameterSource("org", orgId)));
    }

    public String createApiKey(String orgId, String rawKey, String name, List<String> scopes,
                               String expiresAt, String createdBy) {
        var params = new MapSqlParameterSource()
                .addValue("org", orgId)
                .addValue("hash", sha256(rawKey))
                .addValue("name", name)
                .addValue("scopes", scopes.toArray(new String[0]))
                .addValue("expires", expiresAt)
                .addValue("createdBy", createdBy);
        return jdbc.queryForObject("""
                INSERT INTO api_keys (org_id, key_hash, name, scopes, expires_at, created_by)
                VALUES (:org, :hash, :name, :scopes, :expires::timestamptz, :createdBy)
                RETURNING key_id
                """, params, String.class);
    }

    public boolean revokeApiKey(String keyId, String orgId) {
        return jdbc.update("""
                UPDATE api_keys SET revoked_at = NOW()
                WHERE key_id = :id AND org_id = :org AND revoked_at IS NULL
                """,
                new MapSqlParameterSource().addValue("id", keyId).addValue("org", orgId)) > 0;
    }

    // ── Orgs ────────────────────────────────────────────────────────────────────

    public List<Map<String, Object>> listOrgs() {
        return jdbc.queryForList("SELECT org_id, name, plan, created_at FROM orgs ORDER BY created_at", Map.of());
    }

    public void createOrg(String orgId, String name, String plan) {
        jdbc.update("""
                INSERT INTO orgs (org_id, name, plan) VALUES (:id, :name, :plan)
                ON CONFLICT (org_id) DO NOTHING
                """,
                new MapSqlParameterSource().addValue("id", orgId).addValue("name", name).addValue("plan", plan));
    }

    // ── PII policy ──────────────────────────────────────────────────────────────

    public Optional<Map<String, Object>> getPiiPolicy(String orgId) {
        var rows = normalizeRows(jdbc.queryForList(
                "SELECT policy_id, org_id, rules, updated_at FROM pii_policies WHERE org_id = :org",
                new MapSqlParameterSource("org", orgId)));
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void upsertPiiPolicy(String orgId, String rulesJson) {
        jdbc.update("""
                INSERT INTO pii_policies (org_id, rules) VALUES (:org, :rules::jsonb)
                ON CONFLICT (org_id) DO UPDATE SET rules = :rules::jsonb, updated_at = NOW()
                """,
                new MapSqlParameterSource().addValue("org", orgId).addValue("rules", rulesJson));
    }

    // ── Audit log ───────────────────────────────────────────────────────────────

    // The canonical string each entry_hash commits to. Must stay byte-identical
    // between the INSERT below and verifyAuditChain — change one, change both.
    private static final String HASH_INPUT =
            "prev.h || '|' || :org || '|' || coalesce(:actor,'') || '|' || :action"
            + " || '|' || coalesce(:rtype,'') || '|' || coalesce(:rid,'')"
            + " || '|' || to_char(prev.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US')";

    public void audit(String orgId, String actorKeyId, String action,
                      String resourceType, String resourceId) {
        try {
            // Single statement = single transaction, so the advisory xact lock
            // serializes concurrent writers per org and the prev-hash lookup is
            // race-free. ponytail: one global chain head per org is a write
            // bottleneck only if audit volume ever gets hot — shard then.
            jdbc.update("""
                    WITH lk AS (SELECT pg_advisory_xact_lock(hashtext(:org))),
                    prev AS (
                        SELECT COALESCE(
                                   (SELECT entry_hash FROM audit_log
                                    WHERE org_id = :org AND entry_hash IS NOT NULL
                                    ORDER BY id DESC LIMIT 1),
                                   'genesis') AS h,
                               now() AS ts
                        FROM lk
                    )
                    INSERT INTO audit_log (org_id, actor_key_id, action, resource_type, resource_id,
                                           created_at, prev_hash, entry_hash)
                    SELECT :org, :actor, :action, :rtype, :rid, prev.ts, prev.h,
                           encode(digest(%s, 'sha256'), 'hex')
                    FROM prev
                    """.formatted(HASH_INPUT),
                    new MapSqlParameterSource()
                            .addValue("org", orgId)
                            .addValue("actor", actorKeyId)
                            .addValue("action", action)
                            .addValue("rtype", resourceType)
                            .addValue("rid", resourceId));
        } catch (Exception ignored) {
            // Audit writes are best-effort; never fail the request over them.
        }
    }

    public List<Map<String, Object>> getAuditLog(String orgId, int limit, int offset) {
        return normalizeRows(jdbc.queryForList("""
                SELECT id, org_id, actor_key_id, action, resource_type, resource_id, metadata,
                       prev_hash, entry_hash, created_at
                FROM audit_log WHERE org_id = :org
                ORDER BY created_at DESC LIMIT :limit OFFSET :offset
                """,
                new MapSqlParameterSource()
                        .addValue("org", orgId).addValue("limit", limit).addValue("offset", offset)));
    }

    /**
     * Recomputes the org's hash chain. A row edited, removed, or reordered after
     * the fact fails either its own recomputed hash or the linkage to its
     * predecessor. Rows that predate the chain (entry_hash IS NULL) are skipped.
     */
    public Map<String, Object> verifyAuditChain(String orgId) {
        var params = new MapSqlParameterSource("org", orgId);
        Long totalObj = jdbc.queryForObject(
                "SELECT count(*) FROM audit_log WHERE org_id = :org AND entry_hash IS NOT NULL",
                params, Long.class);
        long total = totalObj != null ? totalObj : 0L;
        List<Long> broken = jdbc.queryForList("""
                WITH chained AS (
                    SELECT id, org_id, actor_key_id, action, resource_type, resource_id,
                           created_at, prev_hash, entry_hash,
                           lag(entry_hash) OVER (ORDER BY id) AS expected_prev
                    FROM audit_log
                    WHERE org_id = :org AND entry_hash IS NOT NULL
                )
                SELECT id FROM chained
                WHERE prev_hash IS DISTINCT FROM COALESCE(expected_prev, 'genesis')
                   OR entry_hash IS DISTINCT FROM encode(digest(
                        prev_hash || '|' || org_id || '|' || coalesce(actor_key_id,'')
                        || '|' || action || '|' || coalesce(resource_type,'')
                        || '|' || coalesce(resource_id,'')
                        || '|' || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
                        'sha256'), 'hex')
                ORDER BY id LIMIT 10
                """, params, Long.class);
        return Map.of(
                "valid", broken.isEmpty(),
                "entries_checked", total,
                "broken_entry_ids", broken);
    }
}
