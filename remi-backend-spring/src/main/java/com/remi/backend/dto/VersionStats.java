package com.remi.backend.dto;

/**
 * One row of the version-comparison view: everything measured about spans of ONE
 * agent whose resource carried this service.version. Versions are keyed per
 * agent — comparing releases across different agents is meaningless, and two
 * agents sharing a version string must not merge. Judge fields are null when no
 * verdicts exist; system-metric fields are null when the agent didn't export
 * process metrics.
 */
public record VersionStats(
        String agent,
        String version,
        long sessions,
        long llmCalls,
        long errorSessions,
        double errorRate,
        long avgLlmLatencyMs,
        long p95LlmLatencyMs,
        long totalTokens,
        Double avgCpuPct,
        Long maxRssBytes,
        long verdicts,
        Double avgCorrectness,
        Double avgAdherence,
        Double avgToolQuality,
        String firstSeen,
        String lastSeen) {}
