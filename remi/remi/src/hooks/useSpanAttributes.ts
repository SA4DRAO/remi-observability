import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import type { SpanAttribute, SpanAttributesResponse } from "../types/v2";

export function useSpanAttributes(spanId: string | null) {
  const { data, isPending, error } = useQuery<SpanAttribute[]>({
    queryKey: ["span-attributes", spanId],
    queryFn: async () => {
      if (!spanId) return [];
      const envelope = await apiClient.get<{ success: boolean; data: SpanAttributesResponse }>(
        `/api/v1/events/spans/${spanId}/attributes`
      );
      return envelope.data.attributes;
    },
    enabled: !!spanId,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
  });

  return { attributes: data ?? [], isPending, error: error instanceof Error ? error : null };
}
