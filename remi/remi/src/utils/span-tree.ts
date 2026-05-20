/**
 * Builds a tree from flat OTLP spans using parent_span_id relationships.
 */

import type { SpanV2 } from "../types/v2";

export interface SpanNode {
  span: SpanV2;
  children: SpanNode[];
  depth: number;
}

export function buildSpanTree(spans: SpanV2[]): SpanNode[] {
  if (spans.length === 0) return [];

  const byId = new Map<string, SpanV2>();
  for (const span of spans) {
    byId.set(span.span_id, span);
  }

  // Build nodes without depth first
  const nodeMap = new Map<string, SpanNode>();
  for (const span of spans) {
    nodeMap.set(span.span_id, { span, children: [], depth: 0 });
  }

  const roots: SpanNode[] = [];

  for (const span of spans) {
    const node = nodeMap.get(span.span_id)!;
    const parentId = span.parent_span_id;

    if (parentId && nodeMap.has(parentId)) {
      const parentNode = nodeMap.get(parentId)!;
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Assign depths and sort siblings by start_time_ns
  function assignDepth(nodes: SpanNode[], depth: number): void {
    // Sort siblings ascending by start time
    nodes.sort((a, b) => a.span.start_time_ns - b.span.start_time_ns);
    for (const node of nodes) {
      node.depth = depth;
      if (node.children.length > 0) {
        assignDepth(node.children, depth + 1);
      }
    }
  }

  assignDepth(roots, 0);
  return roots;
}

/** Flatten a span tree into a depth-ordered list for rendering */
export function flattenSpanTree(nodes: SpanNode[]): SpanNode[] {
  const result: SpanNode[] = [];
  function walk(list: SpanNode[]) {
    for (const node of list) {
      result.push(node);
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}
