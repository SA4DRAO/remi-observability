import type { Span } from "../types";

export interface SpanNode {
  span: Span;
  children: SpanNode[];
  depth: number;
}

export function buildSpanTree(spans: Span[]): SpanNode[] {
  if (spans.length === 0) return [];

  const nodeMap = new Map<string, SpanNode>();
  for (const span of spans) {
    nodeMap.set(span.span_id, { span, children: [], depth: 0 });
  }

  const roots: SpanNode[] = [];
  for (const span of spans) {
    const node = nodeMap.get(span.span_id)!;
    const parentId = span.parent_span_id;
    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function assignDepth(nodes: SpanNode[], depth: number): void {
    nodes.sort((a, b) => {
      const ta = new Date(a.span.started_at).getTime();
      const tb = new Date(b.span.started_at).getTime();
      return ta - tb;
    });
    for (const node of nodes) {
      node.depth = depth;
      if (node.children.length > 0) assignDepth(node.children, depth + 1);
    }
  }

  assignDepth(roots, 0);
  return roots;
}

export function flattenSpanTree(nodes: SpanNode[]): SpanNode[] {
  const result: SpanNode[] = [];
  function walk(list: SpanNode[]) {
    for (const node of list) {
      result.push(node);
      if (node.children.length > 0) walk(node.children);
    }
  }
  walk(nodes);
  return result;
}
