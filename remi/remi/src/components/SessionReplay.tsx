import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Span } from "../types";
import { spanColor } from "../utils/format";

interface SessionReplayProps {
  spans: Span[];
  selectedSpanId?: string | null;
  onSpanClick?: (span: Span) => void;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Step through a trace one span at a time. The prompt/response for the current
 * step is rendered by the inspector, so this view is only the transport.
 */
export function SessionReplay({ spans, selectedSpanId, onSpanClick }: SessionReplayProps) {
  const sorted = [...spans].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );
  if (sorted.length === 0) {
    return <p className="py-10 text-center text-[11px] text-muted-foreground">No spans to replay.</p>;
  }

  const index = Math.max(0, sorted.findIndex((s) => s.span_id === selectedSpanId));
  const current = sorted[index];
  const step = (delta: number) => {
    const next = sorted[Math.min(sorted.length - 1, Math.max(0, index + delta))];
    if (next) onSpanClick?.(next);
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-4">
      <div className="flex items-center gap-2.5">
        <button className="ctl ctl-sm w-7 justify-center px-0" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous span">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          className="ctl ctl-sm w-7 justify-center px-0"
          onClick={() => step(1)}
          disabled={index === sorted.length - 1}
          aria-label="Next span"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <span className="kicker">step {index + 1} of {sorted.length}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="h-[5px] w-[5px] rounded-[1px]" style={{ background: spanColor(current) }} />
          <span className="text-xs font-bold">{current.name}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{formatMs(current.duration_ms)}</span>
        </span>
      </div>

      {/* Timeline ribbon — every span, proportional, current one outlined. */}
      <div className="flex h-6 gap-px overflow-hidden rounded-[3px]">
        {sorted.map((s, i) => (
          <button
            key={s.span_id}
            onClick={() => onSpanClick?.(s)}
            title={`${s.name} — ${formatMs(s.duration_ms)}`}
            aria-label={s.name}
            className="min-w-[3px]"
            style={{
              flex: Math.max(1, s.duration_ms),
              background: spanColor(s),
              opacity: i === index ? 1 : 0.45,
              outline: i === index ? "1px solid var(--foreground)" : undefined,
              outlineOffset: -1,
            }}
          />
        ))}
      </div>

      <p className="text-pretty text-[11px] text-muted-foreground">
        Prompt, response, and attributes for this step are in the inspector.
      </p>
    </div>
  );
}
