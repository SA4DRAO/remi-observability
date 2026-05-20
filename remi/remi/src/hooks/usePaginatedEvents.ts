import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '../utils/api-client';
import { logger } from '../utils/logger';
import {
  paginatedEventsResponseSchema,
  type PaginatedEventsResponse,
} from '../types';

interface UsePaginatedEventsOptions {
  sessionId: string;
  orgId?: string | null;
  agentId?: string | null;
  limit?: number;
  initialOffset?: number;
  eventType?: string;
  enabled?: boolean;
  staleTime?: number;
}

export const usePaginatedEvents = (options: UsePaginatedEventsOptions) => {
  const {
    sessionId,
    orgId = null,
    agentId = null,
    limit = 50,
    initialOffset = 0,
    eventType,
    enabled = true,
    staleTime = 3000,
  } = options;

  const queryKey = [
    'events',
    'paginated',
    sessionId,
    orgId ?? 'all',
    agentId ?? 'all',
    limit,
    initialOffset,
    eventType,
  ];

  const { data, isPending, error, refetch, isFetching } = useQuery<
    PaginatedEventsResponse,
    Error
  >({
    queryKey,
    queryFn: async () => {
      try {
        const params: Record<string, string | number> = {
          limit,
          offset: initialOffset,
        };

        if (eventType) {
          params.event_type = eventType;
        }
        if (orgId) {
          params.org_id = orgId;
        }
        if (agentId) {
          params.agent_id = agentId;
        }

        const response = await apiClient.get<PaginatedEventsResponse>(
          `/api/v1/events/sessions/${sessionId}/events`,
          { params }
        );

        const parsedResponse = paginatedEventsResponseSchema.parse(response);

        logger.debug(
          `Fetched paginated events: ${parsedResponse.data.events.length} events (limit=${limit}, offset=${initialOffset}${orgId ? `, org=${orgId}` : ''}${agentId ? `, agent=${agentId}` : ''})`
        );
        return parsedResponse;
      } catch (err) {
        const queryError = err instanceof Error ? err : new Error(String(err));
        logger.error('Failed to fetch paginated events:', queryError);
        throw queryError;
      }
    },
    placeholderData: keepPreviousData,
    enabled: enabled && !!sessionId,
    refetchInterval: 5000,
    staleTime,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    events: data?.data.events || [],
    pagination: data?.data.pagination || {
      limit,
      offset: initialOffset,
      total: 0,
      hasMore: false,
    },
    isPending,
    isFetching,
    error,
    refetch,
    source: data?.source,
  };
};

