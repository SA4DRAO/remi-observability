/**
 * Event types from remi-backend observability system
 */

import { z } from "zod";

export interface EventData extends Record<string, unknown> {
  ts?: string;
  // Trace identifiers
  run_id?: string;
  parent_run_id?: string;
  // LLM-related
  content?: string;
  tool_calls?: ToolCall[];
  usage?: TokenUsage;
  model?: string;
  service_tier?: string;
  finish_reason?: string;
  response_id?: string;
  
  // Tool-related
  tool?: string;
  input?: unknown;
  output?: unknown;
  input_size_bytes?: number;
  output_size_bytes?: number;
  
  // Performance metrics
  duration_ms?: number;
  tokens_per_second?: number;
  agent_loop_iteration?: number;

  // OTEL span fields
  span_name?: string;
  span_category?: string;
  tool_name?: string;
  status_code?: number;
  status_message?: string;
  trace_id?: string;
  span_id?: string;
  
  // Analytics
  total_prompt_length?: number;
  avg_prompt_length?: number;
  estimated_cost_usd?: number;
  
  // Tool metrics
  tool_metrics?: ToolMetrics;
  
  // Error tracking
  error?: string;
  error_type?: string;
  total_errors_in_session?: number;
  error_rate?: number;
  
  // Agent-related
  tool_input?: unknown;
  log?: string;
  return_values?: unknown;
  
  // Chain-related
  chain?: string;
  inputs?: unknown;
  outputs?: unknown;
  
  // Retriever-related
  retriever?: string;
  query?: string;
  docs_count?: number;
  documents?: unknown;
  
  // Text-related
  text?: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolMetrics {
  count: number;
  total_duration_ms: number;
  min_duration_ms: number;
  max_duration_ms: number;
  avg_duration_ms: number;
  error_count?: number;
}

export interface Event {
  id: string | number;
  session_id: string;
  event_type: string;
  created_at: string;
  seq?: number | null;
  run_id?: string;
  parent_run_id?: string;
  org_id?: string | null;
  agent_id?: string | null;
  data: EventData;
}


export interface SessionMetrics {
  totalEvents: number;
  totalTokens: number;
  totalCost: number;
  avgTokensPerCall: number;
  avgLlmTime: number;
  avgToolTime: number;
  promptTokens: number;
  completionTokens: number;
  totalDuration: number;
  llmCallCount: number;
  toolCallCount: number;
  errorCount: number;
  errorRate: number;
  tokensPerSecond: number;
  errorsByType: Record<string, number>;
  toolPerformance: Record<string, ToolPerformanceMetric>;
}

export interface ToolPerformanceMetric {
  count: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
}

const numberLikeSchema = z.coerce.number();

export const eventDataSchema = z.record(z.string(), z.unknown());

export const eventSchema = z.object({
  id: z.union([z.string(), z.number()]),
  session_id: z.string(),
  event_type: z.string(),
  created_at: z.string(),
  seq: numberLikeSchema.int().nullable().optional(),
  run_id: z.string().optional(),
  parent_run_id: z.string().optional(),
  org_id: z.string().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  data: eventDataSchema,
});

export const paginatedEventsResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    events: z.array(eventSchema),
    pagination: z.object({
      limit: numberLikeSchema.int(),
      offset: numberLikeSchema.int(),
      total: numberLikeSchema.int(),
      hasMore: z.boolean(),
    }),
  }),
  source: z.string().optional(),
});

export type PaginatedEventsResponse = z.infer<typeof paginatedEventsResponseSchema>;

export const backendToolUsageSchema = z.object({
  calls: numberLikeSchema.int(),
  total_ms: numberLikeSchema,
  errors: numberLikeSchema.int(),
  avg_ms: numberLikeSchema,
  error_rate: numberLikeSchema,
});

export const backendModelUsageSchema = z.object({
  calls: numberLikeSchema.int(),
  tokens: numberLikeSchema.int(),
});

export const backendSessionMetricsSchema = z.object({
  session_id: z.string(),
  org_id: z.string().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  total_events: numberLikeSchema.int(),
  llm_calls: numberLikeSchema.int(),
  tool_calls: numberLikeSchema.int(),
  error_count: numberLikeSchema.int(),
  prompt_tokens: numberLikeSchema.int(),
  completion_tokens: numberLikeSchema.int(),
  total_tokens: numberLikeSchema.int(),
  token_efficiency: numberLikeSchema.nullable(),
  estimated_cost_usd: numberLikeSchema,
  cost_status: z.enum(["estimated", "partial", "unavailable"]).optional(),
  total_llm_duration_ms: numberLikeSchema,
  avg_llm_duration_ms: numberLikeSchema.nullable(),
  total_tool_duration_ms: numberLikeSchema,
  avg_tool_duration_ms: numberLikeSchema.nullable(),
  max_agent_iteration: numberLikeSchema.int().nullable(),
  finish_reasons: z.record(z.string(), numberLikeSchema.int()),
  tool_usage: z.record(z.string(), backendToolUsageSchema),
  model_usage: z.record(z.string(), backendModelUsageSchema),
  event_type_counts: z.record(z.string(), numberLikeSchema.int()),
  session_duration_ms: numberLikeSchema.nullable(),
  first_event_at: z.string().nullable(),
  last_event_at: z.string().nullable(),
  is_complete: z.boolean(),
  has_error: z.boolean(),
  updated_at: z.string(),
});

export const sessionMetricsResponseSchema = z.object({
  success: z.boolean(),
  data: backendSessionMetricsSchema,
});

export type BackendSessionMetrics = z.infer<typeof backendSessionMetricsSchema>;
export type SessionMetricsResponse = z.infer<typeof sessionMetricsResponseSchema>;
