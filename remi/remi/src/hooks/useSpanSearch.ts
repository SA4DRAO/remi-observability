import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import type { SpanSearchResult } from "../types/v2";

export function useSpanSearch(query: string) {
  const trimmed = query.trim();
  const enabled = trimmed.length >= 2;

  const { data, isPending, isFetching, error } = useQuery<SpanSearchResult[]>({
    queryKey: ["span-search", trimmed],
    queryFn: async () => {
      const envelope = await apiClient.get<{ success: boolean; data: SpanSearchResult[] }>(
        "/api/v1/analytics/search",
        { params: { q: trimmed, limit: 30 } }
      );
      return envelope.data;
    },
    enabled,
    staleTime: 30_000,
    gcTime: 2 * 60_000,
  });

  return {
    results: data ?? [],
    isPending: enabled && isPending,
    isFetching,
    error: error instanceof Error ? error : null,
  };
}
