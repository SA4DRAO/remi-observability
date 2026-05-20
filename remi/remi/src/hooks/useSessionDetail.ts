/**
 * useSessionDetail — fetches a single session's V2 detail from GET /api/v1/sessions/:id
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";
import type { SessionDetailV2 } from "../types/v2";

export function useSessionDetail(sessionId: string | null) {
  const { data, isPending, isLoading, error, refetch } = useQuery<SessionDetailV2 | null>({
    queryKey: ["session-detail-v2", sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      try {
        const envelope = await apiClient.get<{ success: boolean; data: SessionDetailV2 }>(`/api/v1/sessions/${sessionId}`);
        logger.debug(`Fetched session detail for ${sessionId}`);
        return envelope.data;
      } catch (e) {
        logger.error("Failed to fetch session detail", e);
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
    session: data ?? null,
    isPending,
    isLoading,
    error: error instanceof Error ? error : null,
    refetch,
  };
}
