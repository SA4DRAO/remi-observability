package com.remi.backend.dto;

import java.util.Map;

public record Span(
        String spanId,
        String parentSpanId,
        String traceId,
        String name,
        String kind,
        String status,
        String statusMessage,
        String startedAt,
        long durationMs,
        String sessionId,
        String agentId,
        String model,
        String provider,
        Long inputTokens,
        Long outputTokens,
        Long cacheTokens,
        Map<String, String> attributes
) {}
