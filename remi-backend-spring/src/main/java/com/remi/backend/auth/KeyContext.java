package com.remi.backend.auth;

import jakarta.servlet.http.HttpServletRequest;

import java.util.List;

/** Resolved identity of the API key on the current request. Set by ApiKeyFilter. */
public record KeyContext(String keyId, String orgId, List<String> scopes) {

    public static final String ATTR = "remi.keyContext";

    /** admin implies every scope. */
    public boolean hasScope(String scope) {
        return scopes.contains("admin") || scopes.contains(scope);
    }

    public boolean isAdmin() {
        return scopes.contains("admin");
    }

    public static KeyContext of(HttpServletRequest req) {
        Object ctx = req.getAttribute(ATTR);
        if (ctx instanceof KeyContext kc) return kc;
        throw new IllegalStateException("No key context on request — ApiKeyFilter did not run");
    }
}
