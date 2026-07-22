import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import type { SystemMetricSeries } from "../types";

export function useSystemMetrics(sessionId: string) {
  const { data, isPending, error } = useQuery<SystemMetricSeries[]>({
    queryKey: ["system-metrics", sessionId],
    queryFn: async () => {
      const envelope = await apiClient.get<{ success: boolean; data: { metrics: SystemMetricSeries[] } }>(
        `/api/v1/sessions/${sessionId}/system-metrics`
      );
      return envelope.data.metrics;
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  return {
    metrics: data ?? [],
    isPending,
    error: error instanceof Error ? error : null,
  };
}
