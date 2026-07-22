import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";
import type { Span, Pagination } from "../types";

interface SpansResponse {
  spans: Span[];
  pagination: Pagination;
}

interface UseSpansParams {
  kind?: string;
  limit?: number;
  offset?: number;
}

export function useSpans(sessionId: string | null, params: UseSpansParams = {}) {
  const { kind, limit = 200, offset = 0 } = params;

  const { data, isPending, isLoading, error, refetch } = useQuery<SpansResponse>({
    queryKey: ["spans", sessionId, kind ?? "", limit, offset],
    queryFn: async () => {
      if (!sessionId) return { spans: [], pagination: { limit, offset, total: 0, has_more: false } };
      try {
        const queryParams: Record<string, string | number> = { limit, offset };
        if (kind) queryParams.kind = kind;

        const envelope = await apiClient.get<{ success: boolean; data: SpansResponse }>(
          `/api/v1/sessions/${sessionId}/spans`, { params: queryParams }
        );
        const response = envelope.data;
        logger.debug(`Fetched ${response.spans.length} spans for session ${sessionId}`);
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
    spans: data?.spans ?? [],
    total: data?.pagination?.total ?? 0,
    hasMore: data?.pagination?.has_more ?? false,
    isPending,
    isLoading,
    error: error instanceof Error ? error : null,
    refetch,
  };
}
