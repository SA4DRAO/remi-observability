package com.remi.backend.dto;

import java.util.List;

public record Analytics(
        String period,
        Totals totals,
        List<DailyStats> daily,
        List<ModelStats> models,
        List<AgentStats> agents
) {
    public record Totals(
            long sessions,
            long llmCalls,
            long inputTokens,
            long outputTokens,
            long cacheTokens,
            long errorSessions,
            double errorRate,
            long avgLlmLatencyMs,
            long p95LlmLatencyMs
    ) {}

    public record DailyStats(
            String date,
            long sessions,
            long llmCalls,
            long inputTokens,
            long outputTokens,
            long errors,
            long avgLlmLatencyMs
    ) {}

    public record ModelStats(
            String model,
            String provider,
            long calls,
            long inputTokens,
            long outputTokens,
            long cacheTokens,
            long avgLatencyMs
    ) {}

    public record AgentStats(
            String agent,
            long sessions,
            long errors,
            long totalTokens,
            long avgLlmLatencyMs
    ) {}
}
