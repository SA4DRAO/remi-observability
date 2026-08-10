import { useState } from "react";
import { AlertTriangle, ArrowLeft, GitBranch, Network, Play, RotateCw } from "lucide-react";
import { useSession } from "../../hooks/useSession";
import { useSpans } from "../../hooks/useSpans";
import { FlameChart } from "../FlameChart";
import { SessionReplay } from "../SessionReplay";
import { SpanInspector, type InspectorTab } from "../SpanInspector";
import { SpanTree } from "../SpanTree";
import { Skeleton } from "../ui/skeleton";
import { formatDuration, formatLatency, statusColor } from "../../utils/format";
import type { Span } from "../../types";

const VIEWS = [
  { key: "tree", label: "Tree", Icon: Network },
  { key: "flame", label: "Flame", Icon: GitBranch },
  { key: "replay", label: "Replay", Icon: Play },
] as const;

type View = (typeof VIEWS)[number]["key"];

const KIND_LEGEND = [
  ["llm", "var(--chart-1)"],
  ["tool", "var(--chart-5)"],
  ["agent", "var(--chart-2)"],
  ["error", "var(--chart-err)"],
] as const;

function ticks(totalMs: number): string[] {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const ms = totalMs * f;
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
  });
}

/** Where the inspector lands before anything is clicked: the slowest LLM span,
 *  which is what a trace is usually opened to look at. */
function defaultSpan(spans: Span[]): Span | null {
  if (spans.length === 0) return null;
  const llm = spans.filter((s) => s.kind === "llm");
  return (llm.length > 0 ? llm : spans).reduce((a, b) => (b.duration_ms > a.duration_ms ? b : a));
}

export function TracePage({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [pickedSpanId, setPickedSpanId] = useState<string | null>(null);
  const [view, setView] = useState<View>("tree");
  const [tab, setTab] = useState<InspectorTab>("span");
  const [filter, setFilter] = useState("");

  const { session, error: sessionError, refetch: refetchSession } = useSession(sessionId);
  const { spans, hasMore, isPending: spansPending, error: spansError, refetch: refetchSpans } = useSpans(sessionId);

  const selectedSpan = spans.find((s) => s.span_id === pickedSpanId) ?? defaultSpan(spans);
  const setSelectedSpan = (span: Span) => setPickedSpanId(span.span_id);

  const errorSpans = spans.filter((s) => s.status === "error").length;
  const totalMs =
    spans.length === 0
      ? 0
      : Math.max(...spans.map((s) => new Date(s.started_at).getTime() + s.duration_ms)) -
        Math.min(...spans.map((s) => new Date(s.started_at).getTime()));

  const summary: Array<[string, string, string?]> = [
    ["duration", formatDuration(session?.duration_ms ?? totalMs)],
    ["spans", String(session?.span_count ?? spans.length)],
    ["llm calls", String(session?.llm_calls ?? spans.filter((s) => s.kind === "llm").length)],
    ["avg llm", formatLatency(session?.avg_llm_latency_ms)],
    ["tokens", (session?.total_tokens ?? 0).toLocaleString()],
    ["errors", String(errorSpans), errorSpans > 0 ? "var(--err)" : "var(--ok)"],
  ];

  return (
    <div className="flex h-[calc(100vh-48px)] flex-col">
      {/* Trace header */}
      <div className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
        <button className="ctl ctl-sm h-[26px] w-[26px] justify-center px-0" onClick={onBack} aria-label="Back to sessions">
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="text-[13px] font-bold">{session?.agent_id ?? "session"}</span>
          <span className="truncate text-[11px] text-muted-foreground" title={sessionId}>{sessionId}</span>
          {session && (
            <span className="flex shrink-0 items-center gap-1.5 text-[11px]" style={{ color: statusColor(session.status) }}>
              <span className="dot" style={{ background: statusColor(session.status), width: 5, height: 5 }} />
              {session.status}
            </span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-5">
          {summary.map(([label, value, color]) => (
            <span key={label} className="hidden flex-col gap-px text-right sm:flex">
              <span className="kicker" style={{ fontSize: 9 }}>{label}</span>
              <span className="text-[13px] font-bold tabular-nums" style={{ color }}>{value}</span>
            </span>
          ))}
          <button
            className="ctl"
            onClick={() => { void refetchSession(); void refetchSpans(); }}
            aria-label="Refresh trace"
          >
            <RotateCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {(sessionError || spansError) && (
        <div className="flex shrink-0 items-center gap-2 border-b px-6 py-2 text-[11px]" style={{ color: "var(--err)" }}>
          <AlertTriangle className="h-3.5 w-3.5" />
          {(sessionError ?? spansError)?.message}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Span views */}
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex shrink-0 items-center gap-2.5 border-b bg-subtle px-6 py-2">
            <div className="seg seg-sm" role="group" aria-label="Span view">
              {VIEWS.map(({ key, label, Icon }) => (
                <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>
            <input
              className="ctl h-[26px] w-44"
              placeholder="filter spans…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter spans"
            />
            {hasMore && <span className="text-[10px] text-muted-foreground">first {spans.length} spans</span>}
            <span className="ml-auto hidden gap-3 text-[10px] text-muted-foreground md:flex">
              {KIND_LEGEND.map(([label, color]) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
                  {label}
                </span>
              ))}
            </span>
          </div>

          {view === "tree" && (
            <div className="flex shrink-0 items-center border-b px-6 py-1 text-[10px] text-muted-foreground">
              <span className="w-[300px] shrink-0">span</span>
              {ticks(totalMs).map((t, i) => (
                <span key={i} className="flex-1 text-left">{t}</span>
              ))}
              <span className="w-16 shrink-0 text-right">dur</span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {spansPending ? (
              <div className="space-y-1.5 p-4">
                {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
              </div>
            ) : view === "tree" ? (
              <SpanTree spans={spans} selectedSpanId={selectedSpan?.span_id} onSpanClick={setSelectedSpan} filter={filter} />
            ) : view === "flame" ? (
              <FlameChart spans={spans} selectedSpanId={selectedSpan?.span_id} onSpanClick={setSelectedSpan} filter={filter} />
            ) : (
              <SessionReplay spans={spans} selectedSpanId={selectedSpan?.span_id} onSpanClick={setSelectedSpan} />
            )}
          </div>
        </div>

        <SpanInspector
          sessionId={sessionId}
          span={selectedSpan}
          session={session}
          tab={tab}
          onTabChange={setTab}
        />
      </div>
    </div>
  );
}
