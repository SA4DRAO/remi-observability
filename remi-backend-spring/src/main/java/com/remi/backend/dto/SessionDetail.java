package com.remi.backend.dto;

import java.util.Map;

public record SessionDetail(
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
        long avgLlmLatencyMs,
        Map<String, ModelStat> models,
        Map<String, ToolStat> tools,
        // Full resource attributes of the exporting process: host.*, os.*,
        // process.*, gpu info, telemetry.sdk.*, service.version, …
        Map<String, String> resource
) {}
