/**
 * V2 OTLP API types — matches backend V2 response shapes exactly.
 */

// ─── Sessions list ────────────────────────────────────────────────────────────

export interface SessionV2 {
  session_id: string;
  org_id: string;
  agent_id: string;
  created_at: string;
  first_event_at: string | null;
  last_event_at: string | null;
  total_events: number;
  llm_calls: number;
  tool_calls: number;
  error_count: number;
  total_tokens: number;
  estimated_cost_usd: string;
  cost_status: "low" | "medium" | "high";
  is_complete: boolean;
  has_error: boolean;
}

export interface SessionsV2Pagination {
  limit: number;
  offset: number;
  total: number;
}

export interface SessionsV2Response {
  sessions: SessionV2[];
  pagination: SessionsV2Pagination;
}

// ─── Session detail ───────────────────────────────────────────────────────────

export interface ModelUsageEntry {
  spans: number;
  tokens: number;
}

export interface ToolUsageEntry {
  calls: number;
  errors: number;
}

export interface SessionDetailV2 {
  session_id: string;
  org_id: string;
  agent_id: string;
  created_at: string;
  first_event_at: string | null;
  last_event_at: string | null;
  total_spans: number;
  llm_spans: number;
  tool_spans: number;
  error_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  total_cost_usd: string;
  model_usage: Record<string, ModelUsageEntry>;
  tool_usage: Record<string, ToolUsageEntry>;
  is_complete: boolean;
  has_error: boolean;
  total_duration_ns: number | null;
}

// ─── Spans (events) ───────────────────────────────────────────────────────────

export interface SpanV2 {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  kind: number;
  status_code: number;
  status_message: string | null;
  model_name: string | null;
  provider: string | null;
  start_time_ns: number;
  end_time_ns: number;
  duration_ns: number;
  session_id: string;
  org_id: string;
  agent_id: string;
  created_at: string;
}

export interface SpansV2Pagination {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

export interface SpansV2Response {
  events: SpanV2[];
  pagination: SpansV2Pagination;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsV2 {
  period: string;
  total_sessions: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_cost_per_session: number;
  error_sessions: number;
  error_rate: number;
}

// ─── Span attributes ──────────────────────────────────────────────────────────

export interface SpanAttribute {
  key: string;
  value: string | null;
  value_type: "string" | "int" | "float" | "bool" | "null";
}

export interface SpanAttributesResponse {
  span_id: string;
  attributes: SpanAttribute[];
}

// ─── Version metrics ─────────────────────────────────────────────────────────

export interface VersionMetrics {
  agent_id: string;
  agent_version: string;
  session_count: number;
  avg_tokens: number;
  avg_cost_usd: number;
  avg_duration_ns: number;
  error_rate: number;
  total_cost_usd: number;
  avg_llm_spans: number;
  avg_prompt_tokens: number;
  avg_completion_tokens: number;
}

// ─── Span analysis ────────────────────────────────────────────────────────────

export interface SpanAnalysisTimeBreakdown {
  span: string;
  duration_ms: number;
  pct: number;
}

export interface SpanAnalysisSuggestion {
  category: "model" | "prompt" | "architecture" | "caching" | "parallelism";
  title: string;
  detail: string;
  impact: "high" | "medium" | "low";
}

export interface SpanAnalysis {
  summary: string;
  time_breakdown: SpanAnalysisTimeBreakdown[];
  suggestions: SpanAnalysisSuggestion[];
}

export interface SpanAnalysisResponse {
  span_id: string;
  model_used: string;
  analysis: SpanAnalysis;
}

// ─── Filter params ────────────────────────────────────────────────────────────

export interface SessionsQueryParams {
  org_id?: string;
  agent_id?: string;
  limit?: number;
  offset?: number;
  start_date?: string;
  end_date?: string;
  has_error?: boolean;
  is_complete?: boolean;
  min_cost?: number;
  max_cost?: number;
}

export interface AnalyticsQueryParams {
  org_id?: string;
  agent_id?: string;
  start_date?: string;
  end_date?: string;
}

// ─── Session span costs ───────────────────────────────────────────────────────

export interface SpanCost {
  span_id: string;
  span_name: string;
  model_name: string | null;
  duration_ms: number;
  total_cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
}

// ─── Full-text search ─────────────────────────────────────────────────────────

export interface SpanSearchResult {
  span_id: string;
  trace_id: string;
  session_id: string;
  span_name: string;
  model_name: string | null;
  status_code: number;
  matched_key: string;
  snippet: string;
}
