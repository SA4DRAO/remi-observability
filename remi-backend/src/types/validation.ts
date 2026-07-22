import { z } from 'zod';

const OrgIdSchema   = z.string().trim().min(1).max(255);
const AgentIdSchema = z.string().trim().min(1).max(255);

export const SessionListQuerySchema = z.object({
  limit:     z.coerce.number().int().min(1).max(500).default(50),
  offset:    z.coerce.number().int().min(0).default(0),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  date_to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  status:    z.enum(['all', 'complete', 'running', 'error']).default('all'),
});

export const AnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});

export const EventsListQuerySchema = z.object({
  limit:      z.coerce.number().int().min(1).max(1000).default(50),
  offset:     z.coerce.number().int().min(0).default(0),
  event_type: z.string().trim().min(1).max(100).optional(),
});

export const SessionCreateSchema = z.object({
  name:     z.string().trim().min(1).max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  org_id:   OrgIdSchema.optional(),
  agent_id: AgentIdSchema.optional(),
});

export type ValidatedSessionCreate      = z.infer<typeof SessionCreateSchema>;
export type ValidatedAgentId            = z.infer<typeof AgentIdSchema>;
export type ValidatedSessionListQuery   = z.infer<typeof SessionListQuerySchema>;
export type ValidatedEventsListQuery    = z.infer<typeof EventsListQuerySchema>;
export type ValidatedAnalyticsQuery     = z.infer<typeof AnalyticsQuerySchema>;
