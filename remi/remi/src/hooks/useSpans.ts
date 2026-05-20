/**
 * useSpans — fetches spans (OTLP events) for a session via GET /api/v1/events?session_id=X
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";
import type { SpanV2, SpansV2Response } from "../types/v2";

interface UseSpansParams {
  limit?: number;
  offset?: number;
}

export function useSpans(sessionId: string | null, params: UseSpansParams = {}) {
  const { limit = 200, offset = 0 } = params;

  const { data, isPending, isLoading, error, refetch } = useQuery<SpansV2Response>({
    queryKey: ["spans-v2", sessionId, limit, offset],
    queryFn: async () => {
      if (!sessionId) return { events: [], pagination: { limit, offset, total: 0, hasMore: false } };
      try {
        const queryParams: Record<string, string | number> = {
          session_id: sessionId,
          limit,
          offset,
        };
        const envelope = await apiClient.get<{ success: boolean; data: SpansV2Response }>("/api/v1/events", {
          params: queryParams,
        });
        const response = envelope.data;
        logger.debug(`Fetched ${response.events.length} spans for session ${sessionId}`);
        return response;
      } catch (e) {
        logger.error("Failed to fetch spans", e);
        throw e;
      }
    },
    enabled: !!sessionId,
    staleTime: 5_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    gcTime: 5 * 60 * 1000,
  });

  return {
    spans: data?.events ?? [],
    total: data?.pagination?.total ?? 0,
    hasMore: data?.pagination?.hasMore ?? false,
    isPending,
    isLoading,
    error: error instanceof Error ? error : null,
    refetch,
  };
}
