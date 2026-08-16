package com.remi.backend.config;

import com.remi.backend.auth.KeyContext;
import com.remi.backend.repository.IdentityRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.function.Supplier;

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

    private final Map<String, Window> rateWindows = new ConcurrentHashMap<>();

    private final IdentityRepository identity;
    private final String proxySecret;
    private final byte[] proxySecretBytes;
    private final int rateLimitPerMinute;

    ApiKeyFilter(IdentityRepository identity,
                 @Value("${remi.proxy-secret:}") String proxySecret,
                 @Value("${remi.rate-limit-per-minute:600}") int rateLimitPerMinute) {
        this.identity = identity;
        this.proxySecret = proxySecret.trim();
        this.proxySecretBytes = this.proxySecret.getBytes(StandardCharsets.UTF_8);
        this.rateLimitPerMinute = rateLimitPerMinute;
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
        KeyContext ctx = (raw == null || raw.isEmpty()) ? resolveProxyUser(req) : resolve(raw);
        if (ctx == null) {
            unauthorized(res, "Invalid or revoked credentials");
            return;
        }

        if (overRateLimit(ctx.orgId())) {
            res.setStatus(429);
            res.setContentType(MediaType.APPLICATION_JSON_VALUE);
            res.setHeader("Retry-After", "60");
            res.getWriter().write("{\"success\":false,\"error\":\"Rate limit exceeded\"}");
            return;
        }

        req.setAttribute(KeyContext.ATTR, ctx);
        chain.doFilter(req, res);
    }

    /**
     * Fixed one-minute window per org, so one tenant's runaway exporter cannot starve
     * the others. A window boundary allows a burst of up to 2x the limit across it;
     * that is fine for crash protection, which is all this is for.
     *
     * ponytail: in-memory, so the limit is per backend instance — it stops counting
     * correctly the moment a second replica exists. Move to Redis when you scale out.
     */
    private boolean overRateLimit(String orgId) {
        if (rateLimitPerMinute <= 0) return false;
        long window = System.currentTimeMillis() / 60_000;
        var counter = rateWindows.compute(orgId, (k, cur) ->
                (cur == null || cur.window != window) ? new Window(window) : cur);
        return counter.hits.incrementAndGet() > rateLimitPerMinute;
    }

    private static final class Window {
        final long window;
        final AtomicLong hits = new AtomicLong();
        Window(long window) { this.window = window; }
    }

    private KeyContext resolve(String rawKey) {
        return lookupCached(rawKey, () -> identity.findByRawKey(rawKey), rec -> {
            try {
                identity.touchLastUsed(rec.keyId());
            } catch (Exception ignored) {
                // last_used_at is informational only
            }
        });
    }

    /**
     * Dashboard requests carry no key — the reverse proxy authenticates the user via
     * SSO and forwards the verified email. The shared secret is what makes the email
     * trustworthy: without it any client could claim any identity, so an unset secret
     * disables this path entirely rather than failing open.
     */
    private KeyContext resolveProxyUser(HttpServletRequest req) {
        if (proxySecret.isEmpty()) return null;
        String presented = req.getHeader("X-Remi-Proxy-Secret");
        if (presented == null
                || !MessageDigest.isEqual(presented.getBytes(StandardCharsets.UTF_8), proxySecretBytes)) {
            return null;
        }
        String email = req.getHeader("X-Forwarded-Email");
        if (email == null || email.isBlank()) return null;

        return lookupCached("email:" + email, () -> identity.findByEmail(email), rec -> { });
    }

    /**
     * Shared cache-then-lookup path for both auth methods: a positive hit within
     * {@link #CACHE_TTL_MS} short-circuits the DB; a miss calls {@code lookup},
     * caches the result under {@code cacheKey}, and — only on that fresh fetch —
     * runs {@code onFreshFetch} (e.g. throttled last-used bookkeeping).
     */
    private KeyContext lookupCached(
            String cacheKey,
            Supplier<Optional<IdentityRepository.ApiKeyRecord>> lookup,
            Consumer<IdentityRepository.ApiKeyRecord> onFreshFetch) {
        long now = System.currentTimeMillis();
        CacheEntry hit = cache.get(cacheKey);
        if (hit != null && hit.expiresAtMs() > now) return hit.ctx();

        var rec = lookup.get().orElse(null);
        if (rec == null) {
            cache.remove(cacheKey);
            return null;
        }
        KeyContext ctx = new KeyContext(rec.keyId(), rec.orgId(), rec.scopes());
        cache.put(cacheKey, new CacheEntry(ctx, now + CACHE_TTL_MS));
        onFreshFetch.accept(rec);
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
