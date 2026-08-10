import type { Span } from "../types";

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || ms === 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Wall-clock duration — coarser than formatLatency, which is per-LLM-call. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 5,020,000 → "5.02M" — headline numbers only; tables keep full precision. */
export function formatCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  return n.toLocaleString();
}

export function shortId(id: string, head = 8, tail = 6): string {
  return id.length > head + tail + 1 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id;
}

/** Span kind → chart token. Error overrides kind everywhere it is drawn. */
export function spanColor(span: Pick<Span, "kind" | "status">): string {
  if (span.status === "error") return "var(--chart-err)";
  if (span.kind === "llm") return "var(--chart-1)";
  if (span.kind === "tool") return "var(--chart-5)";
  if (span.kind === "agent") return "var(--chart-2)";
  return "var(--muted-foreground)";
}

export function statusColor(status: "running" | "error" | "complete" | string): string {
  if (status === "error") return "var(--err)";
  if (status === "running") return "var(--info)";
  return "var(--ok)";
}
