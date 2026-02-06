import { z } from "zod";
import { logger } from "./logger";

export function parseWithSchema<T>(schema: z.ZodSchema<T>, data: unknown, ctx?: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    logger.error(`Zod validation failed${ctx ? ` (${ctx})` : ""}`, result.error.flatten());
    throw new Error("Invalid API response shape");
  }
  return result.data;
}
