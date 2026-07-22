package com.remi.backend.dto;

public record Session(
        String sessionId,
        String agentId,
        String orgId,
        String startedAt,
        String endedAt,
        Long durationMs,
        String status,
        String primaryModel,
        long spanCount,
        long llmCalls,
        long toolCalls,
        long inputTokens,
        long outputTokens,
        long cacheTokens,
        long totalTokens,
        long avgLlmLatencyMs
) {}
