import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import type { SpanAnalysisResponse } from "../types/v2";

export function useSpanAnalysis(sessionId: string) {
  const { mutate, data, isPending, error, reset } = useMutation<SpanAnalysisResponse, Error, string>({
    mutationFn: async (spanId: string) => {
      const envelope = await apiClient.post<{ success: boolean; data: SpanAnalysisResponse }>(
        `/api/v1/sessions/${sessionId}/analyze-span`,
        { spanId }
      );
      return envelope.data;
    },
  });

  return {
    analyze: mutate,
    result: data ?? null,
    isPending,
    error: error instanceof Error ? error : null,
    reset,
  };
}
