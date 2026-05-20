/**
 * useSessionMetrics Hook
 * Fetches pre-computed session metrics from the backend instead of
 * recalculating them from raw events on the client.
 */

import { useQuery } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";
import {
  sessionMetricsResponseSchema,
  type BackendSessionMetrics,
  type SessionMetrics,
  type SessionMetricsResponse,
} from "../types";

function toSessionMetrics(b: BackendSessionMetrics): SessionMetrics {
  const totalDuration = b.total_llm_duration_ms + b.total_tool_duration_ms;

  const toolPerformance: SessionMetrics["toolPerformance"] = {};
  for (const [name, tool] of Object.entries(b.tool_usage)) {
    toolPerformance[name] = {
      count: tool.calls,
      totalDuration: tool.total_ms,
      avgDuration: tool.avg_ms,
      minDuration: 0,
      maxDuration: 0,
    };
  }

  const errorsByType: Record<string, number> = {};

  return {
    totalEvents: b.total_events,
    totalTokens: b.total_tokens,
    totalCost: b.estimated_cost_usd,
    avgTokensPerCall: b.llm_calls > 0 ? b.total_tokens / b.llm_calls : 0,
    avgLlmTime: b.avg_llm_duration_ms ?? 0,
    avgToolTime: b.avg_tool_duration_ms ?? 0,
    promptTokens: b.prompt_tokens,
    completionTokens: b.completion_tokens,
    totalDuration,
    llmCallCount: b.llm_calls,
    toolCallCount: b.tool_calls,
    errorCount: b.error_count,
    errorRate: b.total_events > 0 ? b.error_count / b.total_events : 0,
    tokensPerSecond: totalDuration > 0 ? (b.total_tokens / totalDuration) * 1000 : 0,
    errorsByType,
    toolPerformance,
  };
}

export function useSessionMetrics(
  sessionId: string | null,
  orgId: string | null = null,
  agentId: string | null = null
) {
  return useQuery<SessionMetrics | null>({
    queryKey: ["session-metrics", sessionId, orgId ?? "all", agentId ?? "all"],
    queryFn: async () => {
      if (!sessionId) return null;

      try {
        const params: Record<string, string> = {};
        if (orgId) {
          params.org_id = orgId;
        }
        if (agentId) {
          params.agent_id = agentId;
        }

        const response = await apiClient.get<{
          success: boolean;
          data: BackendSessionMetrics;
        }>(`/api/v1/sessions/${sessionId}/metrics`, {
          params: Object.keys(params).length > 0 ? params : undefined,
        });

        const parsedResponse = sessionMetricsResponseSchema.parse(
          response
        ) as SessionMetricsResponse;

        if (!parsedResponse?.data) return null;
        return toSessionMetrics(parsedResponse.data);
      } catch (e) {
        const status = (e as AxiosError | undefined)?.response?.status;
        if (status === 404) {
          logger.debug("Session metrics not available yet", {
            sessionId,
            orgId,
            agentId,
            status,
          });
          return null;
        }

        const error = e instanceof Error ? e : new Error(String(e));
        logger.error("Failed to fetch session metrics", error);
        throw error;
      }
    },
    enabled: !!sessionId,
    refetchOnWindowFocus: true,
    staleTime: 3_000,
    refetchInterval: 5_000,
  });
}
