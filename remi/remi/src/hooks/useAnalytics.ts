import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";
import type { Analytics, AnalyticsQueryParams, VersionStats } from "../types";

interface UseAnalyticsOptions extends AnalyticsQueryParams {
  pollingInterval?: number;
}

export function useAnalytics(options: UseAnalyticsOptions = {}) {
  const { pollingInterval = 60_000, org_id, agent_id, date_from, date_to, days = 30 } = options;

  const { data, dataUpdatedAt, isPending, isFetching, error, refetch } = useQuery<Analytics>({
    queryKey: ["analytics", org_id ?? "", agent_id ?? "", date_from ?? "", date_to ?? "", days],
    queryFn: async () => {
      try {
        const params: Record<string, string | number> = { days };
        if (org_id)    params.org_id    = org_id;
        if (agent_id)  params.agent_id  = agent_id;
        if (date_from) params.date_from = date_from;
        if (date_to)   params.date_to   = date_to;

        const envelope = await apiClient.get<{ success: boolean; data: Analytics }>(
          "/api/v1/analytics", { params }
        );
        logger.debug("Fetched analytics");
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
    /** epoch ms of the last successful fetch — drives the "updated Ns ago" clock */
    dataUpdatedAt,
    isPending,
    isFetching,
    error: error instanceof Error ? error : null,
    refetch,
  };
}

/**
 * Per-service.version regression comparison: latency, errors, judge scores.
 * Takes the same window as useAnalytics — the overview mixes the two feeds
 * (regression alerts, the agent table's p95), so an unscoped version query
 * would date-mismatch every row it lands next to.
 */
export function useVersionComparison(agentId?: string, dateFrom?: string) {
  const { data, isPending, error } = useQuery<VersionStats[]>({
    queryKey: ["version-comparison", agentId ?? "", dateFrom ?? ""],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (agentId) params.agent_id = agentId;
      if (dateFrom) params.date_from = dateFrom;
      const envelope = await apiClient.get<{ success: boolean; data: VersionStats[] }>(
        "/api/v1/analytics/versions", { params }
      );
      return envelope.data;
    },
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  return {
    versions: data ?? [],
    isPending,
    error: error instanceof Error ? error : null,
  };
}

/** Judge a random sample of one agent-version's LLM spans so its quality columns fill in. */
export function useSampleJudge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ agent, version }: { agent: string; version: string }) => {
      const envelope = await apiClient.post<{
        success: boolean;
        data: { agent: string; version: string; candidates: number; judged: number };
      }>("/api/v1/analytics/versions/sample-judge", { agent, version, sample: 3 });
      return envelope.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["version-comparison"] });
    },
  });
}
