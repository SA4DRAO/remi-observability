import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";
import type { Session, Pagination, SessionsQueryParams } from "../types";

interface SessionsResponse {
  sessions: Session[];
  pagination: Pagination;
}

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
    date_from,
    date_to,
    status,
  } = options;

  const { data, isPending, isFetching, error, refetch } = useQuery<SessionsResponse>({
    queryKey: ["sessions", org_id ?? "", agent_id ?? "", limit, offset, date_from ?? "", date_to ?? "", status ?? ""],
    queryFn: async () => {
      try {
        const params: Record<string, string | number> = { limit, offset };
        if (org_id)    params.org_id    = org_id;
        if (agent_id)  params.agent_id  = agent_id;
        if (date_from) params.date_from = date_from;
        if (date_to)   params.date_to   = date_to;
        if (status)    params.status    = status;

        const envelope = await apiClient.get<{ success: boolean; data: SessionsResponse }>(
          "/api/v1/sessions", { params }
        );
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

  const sessions: Session[] = data?.sessions ?? [];
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
