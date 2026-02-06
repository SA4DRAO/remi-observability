import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/api-client";
import { logger } from "../utils/logger";
import type { PageInfo } from "../types";
import { PagesResponseSchema } from "../types/schemas";
import { parseWithSchema } from "../utils/validation";

interface UsePagesReturn {
  pages: PageInfo[];
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * usePages Hook
 * Fetches and polls available pages/sessions
 * Automatically refetches at specified interval
 */
export const usePages = (pollingInterval: number = 3000): UsePagesReturn => {
  const { data, isPending, refetch } = useQuery<{ pages: string[] }>({
    queryKey: ["pages"],
    queryFn: async () => {
      const raw = await apiClient.get<unknown>("/pages");
      const parsed = parseWithSchema(PagesResponseSchema, raw, "GET /pages");
      return parsed;
    },
    refetchInterval: pollingInterval,
    refetchOnWindowFocus: true,
    staleTime: 1000,
  });

  return useMemo(
    () => ({
      pages: (data?.pages || []).map((id) => ({ id } as PageInfo)),
      loading: isPending,
      refetch: async () => {
        try {
          await refetch();
        } catch (e) {
          logger.error("Manual refetch failed", e);
        }
      },
    }),
    [data?.pages, isPending, refetch]
  );
};
