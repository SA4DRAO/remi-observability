/**
 * useAnalytics — fetches cross-session analytics from GET /api/v1/sessions/analytics (V2).
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";
import type { AnalyticsV2, AnalyticsQueryParams } from "../types/v2";

// Legacy type aliases kept so old imports don't break at compile time.
export type { AnalyticsV2 as AnalyticsData };

interface UseAnalyticsOptions extends AnalyticsQueryParams {
  pollingInterval?: number;
}

export function useAnalytics(options: UseAnalyticsOptions = {}) {
  const { pollingInterval = 60_000, org_id, agent_id, start_date, end_date } = options;

  const { data, isPending, isFetching, error, refetch } = useQuery<AnalyticsV2>({
    queryKey: ["analytics-v2", org_id ?? "all", agent_id ?? "all", start_date ?? "", end_date ?? ""],
    queryFn: async () => {
      try {
        const params: Record<string, string> = {};
        if (org_id) params.org_id = org_id;
        if (agent_id) params.agent_id = agent_id;
        if (start_date) params.start_date = start_date;
        if (end_date) params.end_date = end_date;

        const envelope = await apiClient.get<{ success: boolean; data: AnalyticsV2 }>("/api/v1/sessions/analytics", { params });
        logger.debug("Fetched V2 analytics");
        return envelope.data;
      } catch (e) {
        logger.error("Failed to fetch analytics", e);
        throw e;
      }
    },
    refetchInterval: pollingInterval,
    refetchOnWindowFocus: true,
    staleTime: 55_000,
    gcTime: 5 * 60 * 1000,
  });

  return {
    analytics: data ?? null,
    isPending,
    isFetching,
    error: error instanceof Error ? error : null,
    refetch,
  };
}
