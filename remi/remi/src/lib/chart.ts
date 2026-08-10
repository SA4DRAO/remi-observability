/** Shared recharts styling so every chart in the console reads as one system. */

export const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 11,
  padding: "6px 9px",
};

export const AXIS_TICK = { fontSize: 10, fill: "var(--muted-foreground)" } as const;

export const GRID = {
  strokeDasharray: "3 3",
  stroke: "var(--border)",
  vertical: false,
} as const;

/** YYYY-MM-DD → MM-DD, the axis label the dense layout has room for. */
export function shortDate(d: string): string {
  return d.slice(5);
}

export function compactTick(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
  return String(v);
}
