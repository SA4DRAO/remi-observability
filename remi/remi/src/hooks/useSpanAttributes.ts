import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import type { SpanAttribute } from "../types";

interface SpanAttributesResponse {
  span_id: string;
  attributes: Record<string, string>;
}

export function useSpanAttributes(spanId: string | null) {
  const { data, isPending, error } = useQuery<SpanAttribute[]>({
    queryKey: ["span-attributes", spanId],
    queryFn: async () => {
      if (!spanId) return [];
      const envelope = await apiClient.get<{ success: boolean; data: SpanAttributesResponse }>(
        `/api/v1/sessions/spans/${spanId}/attributes`
      );
      // Convert Record<string,string> to SpanAttribute[]
      return Object.entries(envelope.data.attributes).map(([key, value]) => ({ key, value }));
    },
    enabled: !!spanId,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
  });

  return { attributes: data ?? [], isPending, error: error instanceof Error ? error : null };
}
