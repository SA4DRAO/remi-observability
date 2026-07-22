package com.remi.backend.config;

import com.remi.backend.auth.KeyContext;
import com.remi.backend.repository.IdentityRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Validates the bearer API key against Postgres (api_keys.key_hash = sha256(raw)).
 * On success, attaches a KeyContext {keyId, orgId, scopes} to the request —
 * controllers scope every query by KeyContext.orgId, never by client-supplied params.
 */
@Component
public class ApiKeyFilter extends OncePerRequestFilter {

    private record CacheEntry(KeyContext ctx, long expiresAtMs) {}

    // ponytail: 30s in-memory positive cache; also throttles last_used_at writes.
    // Move to Caffeine if key count or revocation latency ever matters.
    private static final long CACHE_TTL_MS = 30_000;
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();

    private final IdentityRepository identity;

    ApiKeyFilter(IdentityRepository identity) {
        this.identity = identity;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {

        if ("OPTIONS".equalsIgnoreCase(req.getMethod())) {
            chain.doFilter(req, res);
            return;
        }
        String path = req.getRequestURI();
        if (path.equals("/api/v1/health") || path.startsWith("/actuator")) {
            chain.doFilter(req, res);
            return;
        }

        String raw = extractKey(req);
        if (raw == null || raw.isEmpty()) {
            unauthorized(res, "Missing API key");
            return;
        }

        KeyContext ctx = resolve(raw);
        if (ctx == null) {
            unauthorized(res, "Invalid or revoked API key");
            return;
        }

        req.setAttribute(KeyContext.ATTR, ctx);
        chain.doFilter(req, res);
    }

    private KeyContext resolve(String rawKey) {
        long now = System.currentTimeMillis();
        CacheEntry hit = cache.get(rawKey);
        if (hit != null && hit.expiresAtMs() > now) return hit.ctx();

        var rec = identity.findByRawKey(rawKey).orElse(null);
        if (rec == null) {
            cache.remove(rawKey);
            return null;
        }
        KeyContext ctx = new KeyContext(rec.keyId(), rec.orgId(), rec.scopes());
        cache.put(rawKey, new CacheEntry(ctx, now + CACHE_TTL_MS));
        try {
            identity.touchLastUsed(rec.keyId());
        } catch (Exception ignored) {
            // last_used_at is informational only
        }
        return ctx;
    }

    private static String extractKey(HttpServletRequest req) {
        String auth = req.getHeader("Authorization");
        if (auth != null && auth.startsWith("Bearer ")) return auth.substring(7).trim();
        return req.getHeader("x-api-key");
    }

    private static void unauthorized(HttpServletResponse res, String msg) throws IOException {
        res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        res.getWriter().write("{\"success\":false,\"error\":\"" + msg + "\"}");
    }
}
