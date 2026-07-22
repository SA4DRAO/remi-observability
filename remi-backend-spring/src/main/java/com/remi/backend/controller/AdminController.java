package com.remi.backend.controller;

import com.remi.backend.auth.KeyContext;
import com.remi.backend.dto.ApiResponse;
import com.remi.backend.repository.IdentityRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {

    private static final List<String> ALLOWED_SCOPES =
            List.of("admin", "read:sessions", "read:spans", "read:prompts", "write:sessions");

    private final IdentityRepository identity;
    private final ObjectMapper mapper;
    private final SecureRandom random = new SecureRandom();

    public AdminController(IdentityRepository identity, ObjectMapper mapper) {
        this.identity = identity;
        this.mapper = mapper;
    }

    private static ResponseEntity<Map<String, Object>> forbidden() {
        return ResponseEntity.status(403).body(Map.of("success", false, "error", "Requires admin scope"));
    }

    // ── API keys ────────────────────────────────────────────────────────────────

    @GetMapping("/keys")
    public ResponseEntity<?> listKeys(HttpServletRequest req) {
        KeyContext ctx = KeyContext.of(req);
        if (!ctx.isAdmin()) return forbidden();
        return ResponseEntity.ok(ApiResponse.ok(identity.listApiKeys(ctx.orgId())));
    }

    public record CreateKeyRequest(String name, List<String> scopes, String expiresAt) {}

    @PostMapping("/keys")
    public ResponseEntity<?> createKey(HttpServletRequest req, @RequestBody CreateKeyRequest body) {
        KeyContext ctx = KeyContext.of(req);
        if (!ctx.isAdmin()) return forbidden();
        if (body.name() == null || body.name().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "name is required"));
        }

        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        String rawKey = "remi_" + HexFormat.of().formatHex(bytes);

        List<String> scopes = body.scopes() == null
                ? List.of("read:sessions", "read:spans")
                : body.scopes().stream().filter(ALLOWED_SCOPES::contains).toList();

        String keyId = identity.createApiKey(
                ctx.orgId(), rawKey, body.name().trim(), scopes, body.expiresAt(), ctx.keyId());
        identity.audit(ctx.orgId(), ctx.keyId(), "create:api_key", "api_key", keyId);

        // Raw key is returned ONCE and never stored — caller must save it.
        return ResponseEntity.status(201).body(ApiResponse.ok(
                Map.of("key_id", keyId, "key", rawKey, "scopes", scopes)));
    }

    @DeleteMapping("/keys/{keyId}")
    public ResponseEntity<?> revokeKey(HttpServletRequest req, @PathVariable String keyId) {
        KeyContext ctx = KeyContext.of(req);
        if (!ctx.isAdmin()) return forbidden();
        boolean revoked = identity.revokeApiKey(keyId, ctx.orgId());
        if (!revoked) {
            return ResponseEntity.status(404).body(Map.of("success", false, "error", "Key not found"));
        }
        identity.audit(ctx.orgId(), ctx.keyId(), "revoke:api_key", "api_key", keyId);
        return ResponseEntity.ok(ApiResponse.ok(Map.of("key_id", keyId)));
    }

    // ── Orgs ────────────────────────────────────────────────────────────────────
    // ponytail: any admin key can create orgs; gate behind a platform-admin role
    // if this ever runs multi-customer.

    @GetMapping("/orgs")
    public ResponseEntity<?> listOrgs(HttpServletRequest req) {
        KeyContext ctx = KeyContext.of(req);
        if (!ctx.isAdmin()) return forbidden();
        return ResponseEntity.ok(ApiResponse.ok(identity.listOrgs()));
    }

    public record CreateOrgRequest(String orgId, String name, String plan) {}

    @PostMapping("/orgs")
    public ResponseEntity<?> createOrg(HttpServletRequest req, @RequestBody CreateOrgRequest body) {
        KeyContext ctx = KeyContext.of(req);
        if (!ctx.isAdmin()) return forbidden();
        if (body.orgId() == null || body.orgId().isBlank() || body.name() == null || body.name().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "org_id and name are required"));
        }
        String plan = body.plan() != null ? body.plan() : "starter";
        identity.createOrg(body.orgId().trim(), body.name().trim(), plan);
        identity.audit(ctx.orgId(), ctx.keyId(), "create:org", "org", body.orgId());
        return ResponseEntity.status(201).body(ApiResponse.ok(Map.of("org_id", body.orgId())));
    }

    // ── PII policy ──────────────────────────────────────────────────────────────

    @GetMapping("/pii-policy")
    public ResponseEntity<?> getPiiPolicy(HttpServletRequest req) {
        KeyContext ctx = KeyContext.of(req);
        if (!ctx.isAdmin()) return forbidden();
        return ResponseEntity.ok(ApiResponse.ok(
                identity.getPiiPolicy(ctx.orgId())
                        .orElse(Map.of("org_id", ctx.orgId(), "rules", List.of()))));
    }

    public record PiiPolicyRequest(List<Map<String, Object>> rules) {}

    @PutMapping("/pii-policy")
    public ResponseEntity<?> putPiiPolicy(HttpServletRequest req, @RequestBody PiiPolicyRequest body) throws Exception {
        KeyContext ctx = KeyContext.of(req);
        if (!ctx.isAdmin()) return forbidden();
        if (body.rules() == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "rules must be an array"));
        }
        identity.upsertPiiPolicy(ctx.orgId(), mapper.writeValueAsString(body.rules()));
        identity.audit(ctx.orgId(), ctx.keyId(), "update:pii_policy", "pii_policy", ctx.orgId());
        return ResponseEntity.ok(ApiResponse.ok(Map.of("org_id", ctx.orgId())));
    }

    // ── Audit log ───────────────────────────────────────────────────────────────

    @GetMapping("/audit-log")
    public ResponseEntity<?> auditLog(HttpServletRequest req,
                                      @RequestParam(defaultValue = "50") int limit,
                                      @RequestParam(defaultValue = "0") int offset) {
        KeyContext ctx = KeyContext.of(req);
        if (!ctx.isAdmin()) return forbidden();
        limit = Math.min(Math.max(limit, 1), 500);
        offset = Math.max(offset, 0);
        return ResponseEntity.ok(ApiResponse.ok(identity.getAuditLog(ctx.orgId(), limit, offset)));
    }

    // Recomputes the org's audit hash chain — proves the log wasn't altered.
    @GetMapping("/audit-log/verify")
    public ResponseEntity<?> verifyAuditLog(HttpServletRequest req) {
        KeyContext ctx = KeyContext.of(req);
        if (!ctx.isAdmin()) return forbidden();
        return ResponseEntity.ok(ApiResponse.ok(identity.verifyAuditChain(ctx.orgId())));
    }
}
