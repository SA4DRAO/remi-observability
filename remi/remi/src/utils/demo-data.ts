/**
 * Demo mode: serve the dashboard from a static snapshot instead of the backend.
 *
 * Enabled at build time with VITE_DEMO_MODE=true. `api-client.ts` routes every
 * request through `demoRequest` when it is on, so no hook, page or component
 * knows the difference.
 *
 * The fixture (public/demo-data.json, produced by scripts/snapshot-demo.py)
 * stores only primitives. Anything the browser can compute — filtering,
 * pagination, full-text search — is done here rather than snapshotted per
 * parameter combination, so every filter the UI offers still works instead of
 * only the combinations that happened to be captured. Server-side aggregates
 * (analytics, versions) can't be recomputed, so those are keyed by
 * `${agent}|${days}`.
 */
import type {
  Analytics,
  Session,
  SessionDetail,
  Span,
  SpanAnalysisResponse,
  SpanSearchResult,
  SystemMetricSeries,
  VersionStats,
} from "../types";

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

interface DemoBundle {
  generated_at: string;
  sessions: Session[];
  agents: string[];
  windows: number[];
  analytics: Record<string, Analytics>;
  versions: Record<string, VersionStats[]>;
  details: Record<string, SessionDetail>;
  spans: Record<string, Span[]>;
  metrics: Record<string, SystemMetricSeries[]>;
  attributes: Record<string, Record<string, string>>;
  analysis: Record<string, { span_id: string; model_used: string; analysis: SpanAnalysis }>;
}

type SpanAnalysis = SpanAnalysisResponse["analysis"];
type Params = Record<string, string | number | undefined>;

let bundlePromise: Promise<DemoBundle> | null = null;

/** One fetch for the whole app; every later call reuses the same promise. */
function loadBundle(): Promise<DemoBundle> {
  if (!bundlePromise) {
    bundlePromise = fetch(`${import.meta.env.BASE_URL}demo-data.json`).then((r) => {
      if (!r.ok) throw new Error(`Demo data unavailable (${r.status})`);
      return r.json() as Promise<DemoBundle>;
    });
  }
  return bundlePromise;
}

export function demoGeneratedAt(): Promise<string> {
  return loadBundle().then((b) => b.generated_at);
}

const envelope = <T>(data: T) => ({ success: true, data });

/**
 * Aggregates are keyed by trailing-window size. `useAnalytics` sends `days`
 * directly; `useVersionComparison` only sends `date_from`, so derive it and snap
 * to the nearest captured window.
 */
function windowKey(params: Params, windows: number[]): number {
  let days = Number(params.days);
  if (!Number.isFinite(days) && typeof params.date_from === "string") {
    const ms = Date.now() - new Date(params.date_from).getTime();
    days = Math.round(ms / 86_400_000);
  }
  if (!Number.isFinite(days)) days = 7;
  return windows.reduce((a, b) => (Math.abs(b - days) < Math.abs(a - days) ? b : a), windows[0]);
}

function paginate<T>(rows: T[], params: Params) {
  const limit = Number(params.limit ?? 50);
  const offset = Number(params.offset ?? 0);
  const page = rows.slice(offset, offset + limit);
  return {
    page,
    pagination: { limit, offset, total: rows.length, has_more: offset + limit < rows.length },
  };
}

function searchSpans(bundle: DemoBundle, query: string, limit: number): SpanSearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: SpanSearchResult[] = [];

  for (const [sessionId, spans] of Object.entries(bundle.spans)) {
    for (const span of spans) {
      if (out.length >= limit) return out;
      const attrs = bundle.attributes[span.span_id] ?? {};
      let snippet = "";

      // Prompt/completion bodies, same keys the backend's search covers.
      for (const [key, value] of Object.entries(attrs)) {
        if (!/^(gen_ai\.(prompt|completion|input|output|task\.)|traceloop\.entity\.(input|output))/.test(key)) continue;
        const at = value.toLowerCase().indexOf(q);
        if (at >= 0) {
          snippet = value.slice(Math.max(0, at - 48), Math.max(0, at - 48) + 160);
          break;
        }
      }

      const nameHit = span.name.toLowerCase().includes(q);
      const modelHit = (span.model ?? "").toLowerCase().includes(q);
      if (!snippet && !nameHit && !modelHit) continue;

      out.push({
        span_id: span.span_id,
        trace_id: span.trace_id,
        session_id: sessionId,
        span_name: span.name,
        model: span.model,
        status: span.status,
        snippet,
      });
    }
  }
  return out;
}

/** Shown when a viewer judges a span that has no stored verdict in the snapshot. */
function cannedVerdict(spanId: string): SpanAnalysisResponse {
  return {
    span_id: spanId,
    model_used: "demo-snapshot",
    analysis: {
      summary:
        "This is a static demo, so the judge model isn't called. In a running Remi instance this span would be sent to your configured judge (OPENROUTER_API_KEY) and scored live. Spans that were already judged before the snapshot show their real verdicts.",
      scores: {
        correctness: null,
        instruction_adherence: null,
        tool_use_quality: null,
        hallucination_risk: null,
      },
      flags: [],
      time_breakdown: [],
      suggestions: [],
    },
  };
}

export async function demoRequest(method: "get" | "post", path: string, params: Params = {}, body?: unknown) {
  const b = await loadBundle();
  const p = path.replace(/\/+$/, "");

  if (method === "post") {
    if (p.endsWith("/analyze-span")) {
      const spanId = String((body as { spanId?: string } | undefined)?.spanId ?? "");
      return envelope(b.analysis[spanId] ?? cannedVerdict(spanId));
    }
    if (p.endsWith("/versions/sample-judge")) {
      const req = body as { agent?: string; version?: string } | undefined;
      return envelope({ agent: req?.agent ?? "", version: req?.version ?? "", candidates: 0, judged: 0 });
    }
    throw new Error("This action is disabled in the demo.");
  }

  // ── Analytics ─────────────────────────────────────────────────────────────
  if (p === "/api/v1/analytics" || p === "/api/v1/analytics/versions") {
    const key = `${params.agent_id ?? ""}|${windowKey(params, b.windows)}`;
    const store = p.endsWith("/versions") ? b.versions : b.analytics;
    return envelope(store[key] ?? (p.endsWith("/versions") ? [] : store[`|${windowKey(params, b.windows)}`]));
  }

  // ── Spans: search + attributes (before the /:id routes, which would match) ─
  if (p === "/api/v1/sessions/spans/search") {
    return envelope(searchSpans(b, String(params.q ?? ""), Number(params.limit ?? 30)));
  }
  const attrMatch = p.match(/^\/api\/v1\/sessions\/spans\/([^/]+)\/attributes$/);
  if (attrMatch) {
    return envelope({ span_id: attrMatch[1], attributes: b.attributes[attrMatch[1]] ?? {} });
  }

  // ── Sessions ──────────────────────────────────────────────────────────────
  if (p === "/api/v1/sessions") {
    let rows = b.sessions;
    if (params.agent_id) rows = rows.filter((s) => s.agent_id === params.agent_id);
    if (params.status) rows = rows.filter((s) => s.status === params.status);
    if (params.date_from) rows = rows.filter((s) => s.started_at >= String(params.date_from));
    if (params.date_to) rows = rows.filter((s) => s.started_at <= `${params.date_to}T23:59:59Z`);
    const { page, pagination } = paginate(rows, params);
    return envelope({ sessions: page, pagination });
  }

  const analysisMatch = p.match(/^\/api\/v1\/sessions\/[^/]+\/spans\/([^/]+)\/analysis$/);
  if (analysisMatch) {
    const stored = b.analysis[analysisMatch[1]];
    if (!stored) throw new Error("No stored verdict for this span.");
    return envelope(stored);
  }

  const spansMatch = p.match(/^\/api\/v1\/sessions\/([^/]+)\/spans$/);
  if (spansMatch) {
    let rows = b.spans[spansMatch[1]] ?? [];
    if (params.kind) rows = rows.filter((s) => s.kind === params.kind);
    const { page, pagination } = paginate(rows, { ...params, limit: params.limit ?? 200 });
    return envelope({ spans: page, pagination });
  }

  const metricsMatch = p.match(/^\/api\/v1\/sessions\/([^/]+)\/system-metrics$/);
  if (metricsMatch) {
    return envelope({ metrics: b.metrics[metricsMatch[1]] ?? [] });
  }

  const detailMatch = p.match(/^\/api\/v1\/sessions\/([^/]+)$/);
  if (detailMatch) {
    const detail = b.details[detailMatch[1]];
    if (!detail) throw new Error("Session not in the demo snapshot.");
    return envelope(detail);
  }

  throw new Error(`Not available in the demo: ${p}`);
}
