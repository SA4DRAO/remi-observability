/**
 * useSessions — fetches paginated session list from GET /api/v1/sessions (V2 response shape).
 * Polls every 10 seconds for near-real-time updates.
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";
import type { SessionV2, SessionsV2Response, SessionsQueryParams } from "../types/v2";

// Re-export so downstream code that imported SessionSummary still compiles.
export type { SessionV2 as SessionSummary };

interface UseSessionsOptions extends SessionsQueryParams {
  pollingInterval?: number;
}

export function useSessions(options: UseSessionsOptions = {}) {
  const {
    pollingInterval = 10_000,
    org_id,
    agent_id,
    limit = 50,
    offset = 0,
    start_date,
    end_date,
    has_error,
    is_complete,
    min_cost,
    max_cost,
  } = options;

  const { data, isPending, isFetching, error, refetch } = useQuery<SessionsV2Response>({
    queryKey: [
      "sessions-v2",
      org_id ?? "all",
      agent_id ?? "all",
      limit,
      offset,
      start_date ?? "",
      end_date ?? "",
      has_error ?? "",
      is_complete ?? "",
      min_cost ?? "",
      max_cost ?? "",
    ],
    queryFn: async () => {
      try {
        const params: Record<string, string | number | boolean> = { limit, offset };
        if (org_id) params.org_id = org_id;
        if (agent_id) params.agent_id = agent_id;
        if (start_date) params.start_date = start_date;
        if (end_date) params.end_date = end_date;
        if (has_error !== undefined) params.has_error = has_error;
        if (is_complete !== undefined) params.is_complete = is_complete;
        if (min_cost !== undefined) params.min_cost = min_cost;
        if (max_cost !== undefined) params.max_cost = max_cost;

        const envelope = await apiClient.get<{ success: boolean; data: SessionsV2Response }>("/api/v1/sessions", { params });
        const response = envelope.data;
        logger.debug(`Fetched ${response.sessions.length} sessions`);
        return response;
      } catch (e) {
        logger.error("Failed to fetch sessions", e);
        throw e;
      }
    },
    refetchInterval: pollingInterval,
    refetchOnWindowFocus: true,
    staleTime: Math.max(pollingInterval - 2_000, 3_000),
    gcTime: 5 * 60 * 1000,
  });

  const sessions: SessionV2[] = data?.sessions ?? [];
  const total: number = data?.pagination?.total ?? 0;

  return {
    sessions,
    total,
    hasMore: total > (data?.pagination?.offset ?? 0) + sessions.length,
    isPending,
    isFetching,
    error: error instanceof Error ? error : null,
    refetch,
  };
}
