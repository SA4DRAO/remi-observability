import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import type { VersionMetrics } from "../types/v2";

interface UseVersionMetricsOptions {
  org_id?: string;
  agent_id?: string;
}

export function useVersionMetrics(options: UseVersionMetricsOptions = {}) {
  const { org_id, agent_id } = options;

  const { data, isPending, isFetching, error, refetch } = useQuery<VersionMetrics[]>({
    queryKey: ["version-metrics", org_id ?? "all", agent_id ?? "all"],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (org_id) params.org_id = org_id;
      if (agent_id) params.agent_id = agent_id;
      const envelope = await apiClient.get<{ success: boolean; data: VersionMetrics[] }>(
        "/api/v1/sessions/versions",
        { params }
      );
      return envelope.data;
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  return {
    versions: data ?? [],
    isPending,
    isFetching,
    error: error instanceof Error ? error : null,
    refetch,
  };
}
