import { useMemo, useState } from "react";
import type { Span } from "../types";
import { spanColor } from "../utils/format";
import { buildSpanTree, flattenSpanTree } from "../utils/span-tree";

interface SpanTreeProps {
  spans: Span[];
  selectedSpanId?: string | null;
  onSpanClick?: (span: Span) => void;
  /** Substring match on span name or model; non-matching rows are hidden. */
  filter?: string;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Hierarchy on the left, waterfall on the right — one row per span, so the
 * shape of a trace and where its time went read from the same line.
 */
export function SpanTree({ spans, selectedSpanId, onSpanClick, filter = "" }: SpanTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const nodes = useMemo(() => flattenSpanTree(buildSpanTree(spans)), [spans]);

  const { minMs, rangeMs } = useMemo(() => {
    if (spans.length === 0) return { minMs: 0, rangeMs: 0 };
    const starts = spans.map((s) => new Date(s.started_at).getTime());
    const ends = spans.map((s) => new Date(s.started_at).getTime() + s.duration_ms);
    const min = Math.min(...starts);
    return { minMs: min, rangeMs: Math.max(1, Math.max(...ends) - min) };
  }, [spans]);

  const query = filter.trim().toLowerCase();
  const hasChildren = useMemo(
    () => new Set(spans.map((s) => s.parent_span_id).filter(Boolean) as string[]),
    [spans]
  );

  const visible = nodes.filter((node) => {
    if (query) {
      return (
        node.span.name.toLowerCase().includes(query) ||
        (node.span.model ?? "").toLowerCase().includes(query)
      );
    }
    let parent = node.span.parent_span_id;
    while (parent) {
      if (collapsed.has(parent)) return false;
      parent = nodes.find((n) => n.span.span_id === parent)?.span.parent_span_id ?? null;
    }
    return true;
  });

  if (nodes.length === 0) {
    return <p className="py-10 text-center text-[11px] text-muted-foreground">No spans available.</p>;
  }
  if (visible.length === 0) {
    return <p className="py-10 text-center text-[11px] text-muted-foreground">No spans match “{filter}”.</p>;
  }

  return (
    <div>
      {visible.map(({ span, depth }) => {
        const selected = selectedSpanId === span.span_id;
        const left = ((new Date(span.started_at).getTime() - minMs) / rangeMs) * 100;
        const width = Math.max(0.6, (span.duration_ms / rangeMs) * 100);
        const expandable = hasChildren.has(span.span_id) && !query;
        const color = spanColor(span);

        return (
          <div
            key={span.span_id}
            onClick={() => onSpanClick?.(span)}
            className="flex cursor-pointer items-center border-b hover:bg-muted"
            style={{
              background: selected ? "var(--muted)" : undefined,
              boxShadow: selected ? "inset 2px 0 0 0 var(--foreground)" : undefined,
            }}
          >
            <span
              className="flex w-[300px] min-w-0 shrink-0 items-center gap-1.5 py-1.5 pr-2"
              style={{ paddingLeft: 12 + depth * 14 }}
            >
              <button
                className="w-2.5 shrink-0 text-[9px] text-muted-foreground"
                style={{ visibility: expandable ? "visible" : "hidden" }}
                aria-label={collapsed.has(span.span_id) ? "Expand" : "Collapse"}
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(span.span_id)) next.add(span.span_id);
                    return next;
                  });
                }}
              >
                {collapsed.has(span.span_id) ? "▸" : "▾"}
              </button>
              <span className="h-[5px] w-[5px] shrink-0 rounded-[1px]" style={{ background: color }} />
              <span
                className="truncate text-[11px]"
                style={{ fontWeight: depth === 0 ? 700 : 500 }}
                title={span.name}
              >
                {span.name}
              </span>
              {span.model && (
                <span className="shrink-0 text-[9px] text-muted-foreground">{span.model}</span>
              )}
            </span>

            <span className="relative flex h-[26px] min-w-0 flex-1 items-center">
              <span
                className="absolute h-[11px] rounded-[2px] opacity-85"
                style={{ left: `${left}%`, width: `${width}%`, background: color }}
              />
            </span>

            <span className="w-16 shrink-0 pr-6 text-right text-[11px] tabular-nums text-muted-foreground">
              {formatMs(span.duration_ms)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
