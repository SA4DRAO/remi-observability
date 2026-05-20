import type { Event } from "../types/events";

export interface EventWithDepth {
  event: Event;
  /** 0 = root operation, 1+ = nested child */
  depth: number;
}

/**
 * Build a chronologically-ordered, depth-annotated flat list from a page of
 * events returned by the API (seq ASC, created_at ASC).
 *
 * Algorithm:
 *  1. Sort by seq ASC (with created_at as tiebreaker) so parent *_start events
 *     precede their children — mirrors the DB ORDER BY.
 *  2. Build a parent_run_id → [children] map.
 *  3. DFS from root events (no parent_run_id, or parent not in this page)
 *     to produce a natural execution-order list with visual depth.
 *  4. Any events not reachable from roots (cross-page orphans) are appended
 *     at depth 0 so nothing is silently dropped.
 */
export function buildEventTree(events: Event[]): EventWithDepth[] {
  if (events.length === 0) return [];

  // Sort by seq ASC first (deterministic emission order), fall back to created_at
  const MAX_SEQ = 2_147_483_647;
  const sorted = [...events].sort((a, b) => {
    const seqA = a.seq ?? MAX_SEQ;
    const seqB = b.seq ?? MAX_SEQ;
    if (seqA !== seqB) return seqA - seqB;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Index run_ids present in this page
  const runIds = new Set<string>();
  for (const e of sorted) {
    if (e.run_id) runIds.add(e.run_id);
  }

  // Map parent_run_id → list of direct child events
  const childrenOf = new Map<string, Event[]>();
  for (const e of sorted) {
    if (e.parent_run_id) {
      let bucket = childrenOf.get(e.parent_run_id);
      if (!bucket) {
        bucket = [];
        childrenOf.set(e.parent_run_id, bucket);
      }
      bucket.push(e);
    }
  }

  const visited = new Set<string | number>();
  const result: EventWithDepth[] = [];

  function visit(e: Event, depth: number): void {
    if (visited.has(e.id)) return;
    visited.add(e.id);
    result.push({ event: e, depth });
    if (e.run_id) {
      const children = childrenOf.get(e.run_id) ?? [];
      for (const child of children) {
        visit(child, depth + 1);
      }
    }
  }

  // Start DFS from root events: those whose parent is absent in this page
  const roots = sorted.filter(
    (e) => !e.parent_run_id || !runIds.has(e.parent_run_id)
  );
  for (const root of roots) visit(root, 0);

  // Append any remaining orphans (parent is on another page) at depth 0
  for (const e of sorted) {
    if (!visited.has(e.id)) visit(e, 0);
  }

  return result;
}
