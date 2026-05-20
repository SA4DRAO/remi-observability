import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import type { SpanCost } from "../types/v2";

export function useSessionSpanCosts(sessionId: string) {
  const { data, isPending, error, refetch } = useQuery<SpanCost[]>({
    queryKey: ["session-span-costs", sessionId],
    queryFn: async () => {
      const envelope = await apiClient.get<{ success: boolean; data: SpanCost[] }>(
        `/api/v1/analytics/session-span-costs/${sessionId}`
      );
      return envelope.data;
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    enabled: !!sessionId,
  });

  return {
    spanCosts: data ?? [],
    isPending,
    error: error instanceof Error ? error : null,
    refetch,
  };
}
