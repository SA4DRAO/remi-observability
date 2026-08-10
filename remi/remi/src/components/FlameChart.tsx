import type { Span } from "../types";
import { spanColor } from "../utils/format";

interface FlameChartProps {
  spans: Span[];
  onSpanClick?: (span: Span) => void;
  selectedSpanId?: string | null;
  filter?: string;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/** Concurrency view: spans packed into lanes so overlapping work is visible. */
export function FlameChart({ spans, onSpanClick, selectedSpanId, filter = "" }: FlameChartProps) {
  const query = filter.trim().toLowerCase();
  const valid = spans.filter(
    (s) =>
      s.started_at &&
      s.duration_ms >= 0 &&
      (!query || s.name.toLowerCase().includes(query) || (s.model ?? "").toLowerCase().includes(query))
  );

  if (valid.length === 0) {
    return (
      <p className="py-10 text-center text-[11px] text-muted-foreground">
        {query ? `No spans match “${filter}”.` : "No timing data available."}
      </p>
    );
  }

  const starts = valid.map((s) => new Date(s.started_at).getTime());
  const minMs = Math.min(...starts);
  const maxMs = Math.max(...valid.map((s) => new Date(s.started_at).getTime() + s.duration_ms));
  const totalMs = Math.max(1, maxMs - minMs);

  const sorted = [...valid].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  // Lane packing: first lane whose previous span has already ended.
  const laneEndMs: number[] = [];
  const laneOf = new Map<string, number>();
  for (const span of sorted) {
    const start = new Date(span.started_at).getTime();
    let lane = laneEndMs.findIndex((end) => end <= start);
    if (lane === -1) {
      lane = laneEndMs.length;
      laneEndMs.push(0);
    }
    laneEndMs[lane] = start + span.duration_ms;
    laneOf.set(span.span_id, lane);
  }

  const ROW = 24;

  return (
    <div className="px-6 py-3">
      <div className="relative" style={{ height: laneEndMs.length * ROW }}>
        {[25, 50, 75].map((pct) => (
          <div key={pct} className="absolute bottom-0 top-0 border-l border-dashed opacity-60" style={{ left: `${pct}%` }} />
        ))}
        {sorted.map((span) => {
          const left = ((new Date(span.started_at).getTime() - minMs) / totalMs) * 100;
          const width = Math.max(0.4, (span.duration_ms / totalMs) * 100);
          const selected = selectedSpanId === span.span_id;
          return (
            <button
              key={span.span_id}
              onClick={() => onSpanClick?.(span)}
              title={`${span.name} — ${formatMs(span.duration_ms)}`}
              className="absolute flex h-4 items-center overflow-hidden rounded-[2px] px-1 text-left"
              style={{
                top: (laneOf.get(span.span_id) ?? 0) * ROW + 4,
                left: `${left}%`,
                width: `${width}%`,
                minWidth: 3,
                background: spanColor(span),
                opacity: selected ? 1 : 0.85,
                outline: selected ? "1px solid var(--foreground)" : undefined,
                outlineOffset: 1,
              }}
            >
              <span className="truncate text-[9px] font-medium text-white">
                {width > 12 ? span.name : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
