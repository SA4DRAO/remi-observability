package com.remi.backend.dto;

public record ModelStat(long calls, long inputTokens, long outputTokens, long cacheTokens, long avgLatencyMs) {}
