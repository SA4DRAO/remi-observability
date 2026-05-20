/**
 * FlameChart — Gantt-style horizontal bar chart showing spans in wall-clock time.
 * Clicking a bar selects that span (opens SpanDetailPanel).
 */

import type { SpanV2 } from "../types/v2";

interface FlameChartProps {
  spans: SpanV2[];
  onSpanClick?: (span: SpanV2) => void;
  selectedSpanId?: string | null;
}

function spanColor(span: SpanV2): string {
  const name = span.name.toLowerCase();
  if (span.status_code === 2) return "bg-red-400 dark:bg-red-600";
  if (span.model_name || name.includes("llm") || name.includes("chat") || name.includes("completion"))
    return "bg-blue-400 dark:bg-blue-600";
  if (name.includes("tool") || span.kind === 4)
    return "bg-emerald-400 dark:bg-emerald-600";
  return "bg-slate-400 dark:bg-slate-500";
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function FlameChart({ spans, onSpanClick, selectedSpanId }: FlameChartProps) {
  if (spans.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No spans to display.</p>
    );
  }

  // Filter spans with valid timestamps
  const validSpans = spans.filter((s) => s.start_time_ns > 0 && s.end_time_ns > 0);
  if (validSpans.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No timing data available for these spans.
      </p>
    );
  }

  const minNs = Math.min(...validSpans.map((s) => s.start_time_ns));
  const maxNs = Math.max(...validSpans.map((s) => s.end_time_ns));
  const totalNs = maxNs - minNs;
  if (totalNs === 0) return null;

  // Sort chronologically
  const sorted = [...validSpans].sort((a, b) => a.start_time_ns - b.start_time_ns);

  // Build depth (lane) assignment for visual stacking
  const laneEnds: number[] = [];
  const laneMap = new Map<string, number>();
  for (const span of sorted) {
    let lane = laneEnds.findIndex((endNs) => endNs <= span.start_time_ns);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = span.end_time_ns;
    laneMap.set(span.span_id, lane);
  }
  const totalLanes = laneEnds.length;

  const BAR_HEIGHT = 22;
  const BAR_GAP = 2;
  const LABEL_WIDTH = 160;
  const svgHeight = totalLanes * (BAR_HEIGHT + BAR_GAP) + 24;

  return (
    <div className="overflow-x-auto">
      <div
        className="relative"
        style={{ minWidth: 600 }}
      >
        {/* Time axis */}
        <div className="flex text-[10px] text-muted-foreground mb-1 pl-[160px]">
          {[0, 25, 50, 75, 100].map((pct) => (
            <span key={pct} className="flex-1 text-center">
              {formatMs((totalNs * pct) / 100 / 1e6)}
            </span>
          ))}
        </div>

        {/* Bars */}
        <div className="relative" style={{ height: svgHeight }}>
          {/* Grid lines */}
          {[25, 50, 75].map((pct) => (
            <div
              key={pct}
              className="absolute top-0 bottom-0 border-l border-dashed border-border/50"
              style={{ left: `calc(${LABEL_WIDTH}px + ${pct}% - ${LABEL_WIDTH * pct / 100}px)` }}
            />
          ))}

          {sorted.map((span) => {
            const lane = laneMap.get(span.span_id) ?? 0;
            const leftPct = ((span.start_time_ns - minNs) / totalNs) * 100;
            const widthPct = Math.max(((span.end_time_ns - span.start_time_ns) / totalNs) * 100, 0.2);
            const top = lane * (BAR_HEIGHT + BAR_GAP);
            const isSelected = selectedSpanId === span.span_id;

            return (
              <div
                key={span.span_id}
                className="absolute flex items-center"
                style={{ top, height: BAR_HEIGHT, left: 0, right: 0 }}
              >
                {/* Label column */}
                <div
                  className="shrink-0 pr-2 text-right"
                  style={{ width: LABEL_WIDTH }}
                >
                  <span
                    className="block truncate text-[10px] text-muted-foreground"
                    title={span.name}
                  >
                    {span.name}
                  </span>
                </div>

                {/* Bar area */}
                <div className="relative flex-1 self-stretch">
                  <button
                    className={`absolute h-full rounded transition-opacity ${spanColor(span)} ${
                      isSelected ? "ring-2 ring-primary ring-offset-1 opacity-100" : "opacity-80 hover:opacity-100"
                    }`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      minWidth: 3,
                    }}
                    onClick={() => onSpanClick?.(span)}
                    title={`${span.name} — ${formatMs(span.duration_ns / 1e6)}`}
                  >
                    <span className="absolute inset-0 flex items-center px-1 text-[9px] font-medium text-white truncate pointer-events-none">
                      {widthPct > 5 ? formatMs(span.duration_ns / 1e6) : ""}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground pl-[160px]">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-5 rounded bg-blue-400" /> LLM
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-5 rounded bg-emerald-400" /> Tool
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-5 rounded bg-slate-400" /> Other
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-5 rounded bg-red-400" /> Error
          </span>
        </div>
      </div>
    </div>
  );
}
