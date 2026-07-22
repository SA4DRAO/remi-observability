import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "./ui/badge";
import type { Span } from "../types";
import { buildSpanTree, flattenSpanTree, type SpanNode } from "../utils/span-tree";

interface SpanTreeProps {
  spans: Span[];
  onSpanClick?: (span: Span) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function spanIcon(span: Span): string {
  if (span.kind === "llm") return "💬";
  if (span.kind === "tool") return "🔧";
  if (span.kind === "agent") return "🤖";
  return "⚡";
}

function spanColorClass(span: Span): string {
  if (span.status === "error") return "border-l-red-500";
  if (span.kind === "llm")   return "border-l-blue-400";
  if (span.kind === "tool")  return "border-l-purple-400";
  if (span.kind === "agent") return "border-l-emerald-400";
  return "border-l-slate-400";
}

function computeBarStyle(
  span: Span,
  minMs: number,
  rangeMs: number
): { left: string; width: string } {
  if (rangeMs === 0) return { left: "0%", width: "100%" };
  const startMs = new Date(span.started_at).getTime();
  const leftPct = ((startMs - minMs) / rangeMs) * 100;
  const widthPct = Math.max((span.duration_ms / rangeMs) * 100, 0.5);
  return {
    left: `${Math.max(0, leftPct).toFixed(2)}%`,
    width: `${Math.min(widthPct, 100 - leftPct).toFixed(2)}%`,
  };
}

interface SpanRowProps {
  node: SpanNode;
  minMs: number;
  rangeMs: number;
  isExpanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onSpanClick?: (span: Span) => void;
}

function SpanRow({ node, minMs, rangeMs, isExpanded, hasChildren, onToggle, onSpanClick }: SpanRowProps) {
  const { span, depth } = node;
  const isError = span.status === "error";
  const barStyle = computeBarStyle(span, minMs, rangeMs);

  return (
    <div
      className={`group flex items-center gap-2 border-l-2 py-1.5 pr-3 hover:bg-muted/40 transition-colors cursor-pointer ${spanColorClass(span)}`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => onSpanClick?.(span)}
    >
      <button
        className="shrink-0 text-muted-foreground"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-label={isExpanded ? "Collapse" : "Expand"}
        style={{ visibility: hasChildren ? "visible" : "hidden", width: 16 }}
      >
        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      <span className="shrink-0 text-sm" aria-hidden>{spanIcon(span)}</span>

      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={span.name}>
        {span.name}
      </span>

      {span.model && (
        <Badge variant="secondary" className="shrink-0 font-mono text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-300/40">
          {span.model}
        </Badge>
      )}

      {isError && (
        <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[10px]">error</Badge>
      )}

      <div className="relative mx-2 hidden h-4 w-32 shrink-0 overflow-hidden rounded-sm bg-muted sm:block">
        <div
          className={`absolute top-0 h-full rounded-sm opacity-70 ${
            isError ? "bg-red-500" : span.kind === "llm" ? "bg-blue-400" : "bg-slate-400"
          }`}
          style={{ left: barStyle.left, width: barStyle.width }}
        />
      </div>

      <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {formatDuration(span.duration_ms)}
      </span>
    </div>
  );
}

export function SpanTree({ spans, onSpanClick }: SpanTreeProps) {
  const roots = buildSpanTree(spans);
  const allNodes = flattenSpanTree(roots);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (allNodes.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">No spans available</div>
    );
  }

  const allMs = spans.map((s) => new Date(s.started_at).getTime());
  const minMs  = Math.min(...allMs);
  const maxMs  = Math.max(...spans.map((s) => new Date(s.started_at).getTime() + s.duration_ms));
  const rangeMs = maxMs - minMs;

  // Filter out nodes whose ancestors are collapsed
  const visibleNodes = allNodes.filter((node) => {
    let current = node.span.parent_span_id;
    while (current) {
      if (collapsed.has(current)) return false;
      const parent = allNodes.find((n) => n.span.span_id === current);
      current = parent?.span.parent_span_id ?? null;
    }
    return true;
  });

  return (
    <div className="divide-y divide-border/50">
      {visibleNodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = !collapsed.has(node.span.span_id);
        return (
          <SpanRow
            key={node.span.span_id}
            node={node}
            minMs={minMs}
            rangeMs={rangeMs}
            isExpanded={isExpanded}
            hasChildren={hasChildren}
            onToggle={() => {
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(node.span.span_id)) next.delete(node.span.span_id);
                else next.add(node.span.span_id);
                return next;
              });
            }}
            onSpanClick={onSpanClick}
          />
        );
      })}
    </div>
  );
}
