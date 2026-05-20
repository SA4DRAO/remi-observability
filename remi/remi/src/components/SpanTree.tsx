/**
 * SpanTree — renders a collapsible indented span tree with timing info.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "./ui/badge";
import type { SpanV2 } from "../types/v2";
import { buildSpanTree, flattenSpanTree, type SpanNode } from "../utils/span-tree";

interface SpanTreeProps {
  spans: SpanV2[];
  onSpanClick?: (span: SpanV2) => void;
}

function formatDuration(ns: number): string {
  const ms = ns / 1_000_000;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function spanIcon(span: SpanV2): string {
  const nameLower = span.name.toLowerCase();
  if (span.model_name || nameLower.includes("llm") || nameLower.includes("chat") || nameLower.includes("completion")) {
    return "💬";
  }
  if (nameLower.includes("tool") || nameLower.includes("function")) {
    return "🔧";
  }
  return "⚡";
}

function spanColorClass(span: SpanV2): string {
  const nameLower = span.name.toLowerCase();
  if (span.status_code === 2) return "border-l-red-500";
  if (span.model_name || nameLower.includes("llm") || nameLower.includes("chat") || nameLower.includes("completion")) {
    return "border-l-blue-400";
  }
  if (nameLower.includes("tool") || nameLower.includes("function")) {
    return "border-l-purple-400";
  }
  return "border-l-slate-400";
}

// Compute timeline bar: percentage offset + width relative to the session window
function computeBarStyle(
  span: SpanV2,
  minNs: number,
  rangeNs: number
): { left: string; width: string } {
  if (rangeNs === 0) return { left: "0%", width: "100%" };
  const leftPct = ((span.start_time_ns - minNs) / rangeNs) * 100;
  const widthPct = Math.max((span.duration_ns / rangeNs) * 100, 0.5);
  return {
    left: `${Math.max(0, leftPct).toFixed(2)}%`,
    width: `${Math.min(widthPct, 100 - leftPct).toFixed(2)}%`,
  };
}

interface SpanRowProps {
  node: SpanNode;
  minNs: number;
  rangeNs: number;
  isExpanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onSpanClick?: (span: SpanV2) => void;
}

function SpanRow({ node, minNs, rangeNs, isExpanded, hasChildren, onToggle, onSpanClick }: SpanRowProps) {
  const { span, depth } = node;
  const isError = span.status_code === 2;
  const barStyle = computeBarStyle(span, minNs, rangeNs);
  const icon = spanIcon(span);
  const colorClass = spanColorClass(span);

  return (
    <div
      className={`group flex items-center gap-2 border-l-2 py-1.5 pr-3 hover:bg-muted/40 transition-colors cursor-pointer ${colorClass}`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => onSpanClick?.(span)}
    >
      {/* Expand/collapse toggle */}
      <button
        className="shrink-0 text-muted-foreground"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-label={isExpanded ? "Collapse" : "Expand"}
        style={{ visibility: hasChildren ? "visible" : "hidden", width: 16 }}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Icon */}
      <span className="shrink-0 text-sm" aria-hidden>
        {icon}
      </span>

      {/* Span name */}
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={span.name}>
        {span.name}
      </span>

      {/* Model badge */}
      {span.model_name && (
        <Badge
          variant="secondary"
          className="shrink-0 font-mono text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-300/40"
        >
          {span.model_name}
        </Badge>
      )}

      {/* Error badge */}
      {isError && (
        <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[10px]">
          error
        </Badge>
      )}

      {/* Timeline bar */}
      <div className="relative mx-2 hidden h-4 w-32 shrink-0 overflow-hidden rounded-sm bg-muted sm:block">
        <div
          className={`absolute top-0 h-full rounded-sm opacity-70 ${
            isError
              ? "bg-red-500"
              : span.model_name
                ? "bg-blue-400"
                : "bg-slate-400"
          }`}
          style={{ left: barStyle.left, width: barStyle.width }}
        />
      </div>

      {/* Duration */}
      <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {formatDuration(span.duration_ns)}
      </span>
    </div>
  );
}

export function SpanTree({ spans, onSpanClick }: SpanTreeProps) {
  const roots = buildSpanTree(spans);
  const allNodes = flattenSpanTree(roots);

  // Collapsed set — collapsed by span_id
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (allNodes.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No spans available
      </div>
    );
  }

  // Compute timeline bounds
  const minNs = Math.min(...spans.map((s) => s.start_time_ns));
  const maxNs = Math.max(...spans.map((s) => s.end_time_ns));
  const rangeNs = maxNs - minNs;

  // Compute which span_ids have children
  const hasChildrenMap = new Map<string, boolean>();
  for (const node of allNodes) {
    hasChildrenMap.set(node.span.span_id, node.children.length > 0);
  }

  // Compute which nodes are hidden (their ancestor is collapsed)
  const collapsedSet = collapsed;
  const hiddenIds = new Set<string>();
  function markHidden(nodes: SpanNode[]) {
    for (const node of nodes) {
      hiddenIds.add(node.span.span_id);
      markHidden(node.children);
    }
  }
  for (const node of allNodes) {
    if (collapsedSet.has(node.span.span_id) && node.children.length > 0) {
      markHidden(node.children);
    }
  }

  const toggleCollapse = (spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  const visibleNodes = allNodes.filter((n) => !hiddenIds.has(n.span.span_id));

  return (
    <div className="divide-y divide-border rounded-md border text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
        <span className="flex-1">Span</span>
        <span className="mx-2 hidden w-32 text-right sm:block">Timeline</span>
        <span className="w-16 text-right">Duration</span>
      </div>

      {visibleNodes.map((node) => (
        <SpanRow
          key={node.span.span_id}
          node={node}
          minNs={minNs}
          rangeNs={rangeNs}
          isExpanded={!collapsedSet.has(node.span.span_id)}
          hasChildren={hasChildrenMap.get(node.span.span_id) ?? false}
          onToggle={() => toggleCollapse(node.span.span_id)}
          onSpanClick={onSpanClick}
        />
      ))}
    </div>
  );
}
