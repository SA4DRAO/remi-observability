// ─── Sessions ────────────────────────────────────────────────────────────────

export interface Session {
  session_id: string;
  agent_id: string | null;
  org_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  status: "running" | "error" | "complete";
  primary_model: string | null;
  span_count: number;
  llm_calls: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  total_tokens: number;
  avg_llm_latency_ms: number;
}

export interface ModelStat {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  avg_latency_ms: number;
}

export interface ToolStat {
  calls: number;
  errors: number;
}

export interface SessionDetail extends Session {
  models: Record<string, ModelStat>;
  tools: Record<string, ToolStat>;
  /** Resource attributes of the exporting process: host.*, os.*, process.*, gpu, sdk info */
  resource: Record<string, string>;
}

export interface Pagination {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
}

// ─── Spans ────────────────────────────────────────────────────────────────────

export interface Span {
  span_id: string;
  parent_span_id: string | null;
  trace_id: string;
  name: string;
  kind: "llm" | "tool" | "agent" | "other";
  status: "ok" | "error" | "unset";
  status_message: string | null;
  started_at: string;
  duration_ms: number;
  session_id: string;
  agent_id: string | null;
  model: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_tokens: number | null;
  attributes: Record<string, string>;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface DailyStats {
  date: string;
  sessions: number;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  errors: number;
  avg_llm_latency_ms: number;
}

export interface ModelStats {
  model: string;
  provider: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  avg_latency_ms: number;
}

export interface AgentStats {
  agent: string;
  sessions: number;
  errors: number;
  total_tokens: number;
  avg_llm_latency_ms: number;
}

export interface VersionStats {
  agent: string;
  version: string;
  sessions: number;
  llm_calls: number;
  error_sessions: number;
  error_rate: number;
  avg_llm_latency_ms: number;
  p95_llm_latency_ms: number;
  total_tokens: number;
  avg_cpu_pct: number | null;
  max_rss_bytes: number | null;
  verdicts: number;
  avg_correctness: number | null;
  avg_adherence: number | null;
  avg_tool_quality: number | null;
  first_seen: string;
  last_seen: string;
}

export interface Analytics {
  period: string;
  totals: {
    sessions: number;
    llm_calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_tokens: number;
    error_sessions: number;
    error_rate: number;
    avg_llm_latency_ms: number;
    p95_llm_latency_ms: number;
  };
  daily: DailyStats[];
  models: ModelStats[];
  agents: AgentStats[];
}

// ─── Span attributes + search ─────────────────────────────────────────────────

export interface SpanAttribute {
  key: string;
  value: string | null;
}

export interface SpanSearchResult {
  span_id: string;
  trace_id: string;
  session_id: string;
  span_name: string;
  model: string | null;
  status: string;
}

// ─── Span analysis ────────────────────────────────────────────────────────────

export interface SpanAnalysisSuggestion {
  category: "model" | "prompt" | "architecture" | "caching" | "parallelism";
  title: string;
  detail: string;
  impact: "high" | "medium" | "low";
}

export interface SpanAnalysisScores {
  correctness: number | null;
  instruction_adherence: number | null;
  tool_use_quality: number | null;
  hallucination_risk: "low" | "medium" | "high" | null;
}

export interface SpanAnalysis {
  summary: string;
  scores?: Partial<SpanAnalysisScores>;
  flags?: string[];
  time_breakdown: Array<{ span: string; duration_ms: number; pct: number }>;
  suggestions: SpanAnalysisSuggestion[];
}

export interface SpanAnalysisResponse {
  span_id: string;
  model_used: string;
  analysis: SpanAnalysis;
}

// ─── Query params ─────────────────────────────────────────────────────────────

export interface SessionsQueryParams {
  org_id?: string;
  agent_id?: string;
  limit?: number;
  offset?: number;
  date_from?: string;
  date_to?: string;
  status?: "running" | "error" | "complete";
}

export interface AnalyticsQueryParams {
  org_id?: string;
  agent_id?: string;
  date_from?: string;
  date_to?: string;
  days?: number;
}

// ─── System metrics (per-session CPU/memory time series) ─────────────────────

export interface SystemMetricPoint {
  ts: string;
  value: number;
}

export interface SystemMetricSeries {
  name: string;
  points: SystemMetricPoint[];
}
