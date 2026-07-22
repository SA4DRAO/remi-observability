import type { Span } from "../types";

interface FlameChartProps {
  spans: Span[];
  onSpanClick?: (span: Span) => void;
  selectedSpanId?: string | null;
}

function spanColor(span: Span): string {
  if (span.status === "error")  return "bg-red-400 dark:bg-red-600";
  if (span.kind === "llm")      return "bg-blue-400 dark:bg-blue-600";
  if (span.kind === "tool")     return "bg-emerald-400 dark:bg-emerald-600";
  if (span.kind === "agent")    return "bg-violet-400 dark:bg-violet-600";
  return "bg-slate-400 dark:bg-slate-500";
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function FlameChart({ spans, onSpanClick, selectedSpanId }: FlameChartProps) {
  if (spans.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No spans to display.</p>;
  }

  const validSpans = spans.filter((s) => s.started_at && s.duration_ms >= 0);
  if (validSpans.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No timing data available.</p>;
  }

  const startTimes = validSpans.map((s) => new Date(s.started_at).getTime());
  const endTimes   = validSpans.map((s) => new Date(s.started_at).getTime() + s.duration_ms);
  const minMs      = Math.min(...startTimes);
  const maxMs      = Math.max(...endTimes);
  const totalMs    = maxMs - minMs;
  if (totalMs === 0) return null;

  const sorted = [...validSpans].sort((a, b) =>
    new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  // Lane assignment: pack spans into horizontal rows without overlap.
  // Only the first span of each lane gets a gutter label — later spans in the
  // same lane would overprint it; their names live in the bar tooltip instead.
  const laneEndMs: number[] = [];
  const laneMap = new Map<string, number>();
  const laneLabelSpan = new Set<string>();
  for (const span of sorted) {
    const spanStart = new Date(span.started_at).getTime();
    let lane = laneEndMs.findIndex((endMs) => endMs <= spanStart);
    if (lane === -1) {
      lane = laneEndMs.length;
      laneEndMs.push(0);
      laneLabelSpan.add(span.span_id);
    }
    laneEndMs[lane] = spanStart + span.duration_ms;
    laneMap.set(span.span_id, lane);
  }
  const totalLanes = laneEndMs.length;

  const BAR_HEIGHT  = 22;
  const BAR_GAP     = 2;
  const LABEL_WIDTH = 160;
  const svgHeight   = totalLanes * (BAR_HEIGHT + BAR_GAP) + 24;

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ minWidth: 600 }}>
        {/* Time axis */}
        <div className="flex text-[10px] text-muted-foreground mb-1 pl-[160px]">
          {[0, 25, 50, 75, 100].map((pct) => (
            <span key={pct} className="flex-1 text-center">
              {formatMs((totalMs * pct) / 100)}
            </span>
          ))}
        </div>

        <div className="relative" style={{ height: svgHeight }}>
          {[25, 50, 75].map((pct) => (
            <div
              key={pct}
              className="absolute top-0 bottom-0 border-l border-dashed border-border/50"
              style={{ left: `calc(${LABEL_WIDTH}px + ${pct}% - ${LABEL_WIDTH * pct / 100}px)` }}
            />
          ))}

          {sorted.map((span) => {
            const lane       = laneMap.get(span.span_id) ?? 0;
            const spanStartMs = new Date(span.started_at).getTime();
            const leftPct    = ((spanStartMs - minMs) / totalMs) * 100;
            const widthPct   = Math.max((span.duration_ms / totalMs) * 100, 0.2);
            const top        = lane * (BAR_HEIGHT + BAR_GAP);
            const isSelected = selectedSpanId === span.span_id;

            return (
              <div
                key={span.span_id}
                className="absolute flex items-center"
                style={{ top, height: BAR_HEIGHT, left: 0, right: 0 }}
              >
                <div className="shrink-0 pr-2 text-right" style={{ width: LABEL_WIDTH }}>
                  {laneLabelSpan.has(span.span_id) && (
                    <span className="block truncate text-[10px] text-muted-foreground" title={span.name}>
                      {span.name}
                    </span>
                  )}
                </div>

                <div className="relative flex-1 self-stretch">
                  <button
                    className={`absolute h-full rounded transition-opacity ${spanColor(span)} ${
                      isSelected ? "ring-2 ring-primary ring-offset-1 opacity-100" : "opacity-80 hover:opacity-100"
                    }`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 3 }}
                    onClick={() => onSpanClick?.(span)}
                    title={`${span.name} — ${formatMs(span.duration_ms)}`}
                  >
                    <span className="absolute inset-0 flex items-center px-1 text-[9px] font-medium text-white truncate pointer-events-none">
                      {widthPct > 5 ? formatMs(span.duration_ms) : ""}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
