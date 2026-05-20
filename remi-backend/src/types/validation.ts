import { z } from 'zod';

const OrgIdSchema   = z.string().trim().min(1).max(255);
const AgentIdSchema = z.string().trim().min(1).max(255);

/**
 * Query parameter schema for GET /sessions.
 * Coerces string query params to numbers and enforces valid ranges.
 * New filter params: date_from/date_to (YYYY-MM-DD), status, min_cost, max_cost.
 */
export const SessionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  status: z.enum(['all', 'complete', 'running', 'error']).default('all'),
  min_cost: z.coerce.number().min(0).optional(),
  max_cost: z.coerce.number().min(0).optional(),
});

/**
 * Query parameter schema for GET /sessions/analytics.
 * days: look-back window in days (7, 30, or up to 90).
 */
export const AnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});

/**
 * Query parameter schema for GET /sessions/:id/events.
 * Extends pagination with an optional event_type filter.
 */
export const EventsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  event_type: z.string().trim().min(1).max(100).optional(),
});

export const SessionCreateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  org_id: OrgIdSchema.optional(),
  agent_id: AgentIdSchema.optional(),
});

// ---------------------------------------------------------------------------
// OTLP JSON wire-format schemas
// The OTLP JSON spec is stable (CNCF/OTel); not tied to any SDK internals.
// ---------------------------------------------------------------------------

const OtlpAttributeValueSchema = z.object({
  stringValue: z.string().optional(),
  intValue: z.union([z.number(), z.string()]).optional(),
  doubleValue: z.number().optional(),
  boolValue: z.boolean().optional(),
  // OTLP arrays (e.g. gen_ai.response.finish_reasons)
  arrayValue: z
    .object({ values: z.array(z.record(z.string(), z.unknown())).optional() })
    .optional(),
  // OTLP key-value lists
  kvlistValue: z
    .object({ values: z.array(z.record(z.string(), z.unknown())).optional() })
    .optional(),
});

const OtlpAttributeSchema = z.object({
  key: z.string(),
  value: OtlpAttributeValueSchema,
});

const OtlpStatusSchema = z.object({
  code: z.number().optional(),
  message: z.string().optional(),
});

const OtlpSpanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  name: z.string(),
  kind: z.number().optional(),
  startTimeUnixNano: z.string().optional(),
  endTimeUnixNano: z.string().optional(),
  attributes: z.array(OtlpAttributeSchema).optional(),
  status: OtlpStatusSchema.optional(),
});

const OtlpScopeSpanSchema = z.object({
  scope: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
  spans: z.array(OtlpSpanSchema).optional(),
});

const OtlpResourceSchema = z.object({
  attributes: z.array(OtlpAttributeSchema).optional(),
});

const OtlpResourceSpanSchema = z.object({
  resource: OtlpResourceSchema.optional(),
  scopeSpans: z.array(OtlpScopeSpanSchema).optional(),
});

export const OtlpPayloadSchema = z.object({
  resourceSpans: z.array(OtlpResourceSpanSchema).optional(),
});

export type OtlpPayload = z.infer<typeof OtlpPayloadSchema>;
export type OtlpAttribute = z.infer<typeof OtlpAttributeSchema>;
export type OtlpAttributeValue = z.infer<typeof OtlpAttributeValueSchema>;

/**
 * TypeScript types inferred from Zod schemas.
 * Use these for type-safe event handling after validation.
 */
export type ValidatedSessionCreate = z.infer<typeof SessionCreateSchema>;
export type ValidatedAgentId = z.infer<typeof AgentIdSchema>;
export type ValidatedSessionListQuery = z.infer<typeof SessionListQuerySchema>;
export type ValidatedEventsListQuery = z.infer<typeof EventsListQuerySchema>;
export type ValidatedAnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;
