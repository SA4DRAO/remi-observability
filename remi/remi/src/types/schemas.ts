import { z } from "zod";

export const AgentResponseSchema = z.object({
  success: z.boolean(),
  reply: z.string(),
  actionsLog: z.array(z.string()),
  sessionId: z.string(),
  pageId: z.string(),
  actionCount: z.number().int().nonnegative(),
  currentUrl: z.string(),
  error: z.string().optional(),
});

export type AgentResponseDto = z.infer<typeof AgentResponseSchema>;

export const PagesResponseSchema = z.object({
  pages: z.array(z.string()),
});

export type PagesResponseDto = z.infer<typeof PagesResponseSchema>;
