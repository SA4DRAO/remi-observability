import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useSystemMetrics } from "../hooks/useSystemMetrics";
import { AXIS_TICK, GRID, TOOLTIP_STYLE } from "../lib/chart";
import { Skeleton } from "./ui/skeleton";
import type { SystemMetricSeries } from "../types";

// Which emitted metrics get a chart, and how to render their values.
// Everything else the agent exports is still queryable via the API.
// system.cpu.* is emitted per-core (16 interleaved series) so it isn't charted;
// process-level metrics describe the agent itself.
const CHARTED: Array<{ match: (name: string) => boolean; title: string; unit: "percent" | "bytes" }> = [
  { match: (n) => n.startsWith("process.cpu.utilization") || n.startsWith("process.runtime.cpython.cpu.utilization"), title: "Process CPU", unit: "percent" },
  { match: (n) => n.startsWith("process.memory.usage") || n.startsWith("process.runtime.cpython.memory (rss)"), title: "Memory RSS", unit: "bytes" },
  { match: (n) => n.startsWith("process.memory.virtual"), title: "Memory virtual", unit: "bytes" },
  { match: (n) => n.startsWith("system.memory.utilization (used)"), title: "System memory used", unit: "percent" },
];

function formatValue(v: number, unit: "percent" | "bytes"): string {
  if (unit === "percent") return `${(v * 100).toFixed(1)}%`;
  if (v >= 1 << 30) return `${(v / (1 << 30)).toFixed(2)} GiB`;
  if (v >= 1 << 20) return `${(v / (1 << 20)).toFixed(0)} MiB`;
  return `${Math.round(v / 1024)} KiB`;
}

function timeLabel(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

function MetricChart({
  series,
  title,
  unit,
  color,
}: {
  series: SystemMetricSeries;
  title: string;
  unit: "percent" | "bytes";
  color: string;
}) {
  const peak = Math.max(...series.points.map((p) => p.value));
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="kicker">{title}</span>
        <span className="ml-auto text-[11px] tabular-nums">peak {formatValue(peak, unit)}</span>
      </div>
      <div className="h-24 rounded-md border p-1.5">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series.points} margin={{ top: 2, right: 2, left: -28, bottom: -8 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="ts" tickFormatter={timeLabel} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={44} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatValue(v, unit)} width={58} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(l) => timeLabel(String(l))}
              formatter={(value) => [formatValue(Number(value), unit), title]}
            />
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.12} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)"];

export function SystemMetricsPanel({ sessionId }: { sessionId: string }) {
  const { metrics, isPending } = useSystemMetrics(sessionId);

  const charts = CHARTED.flatMap((c) => {
    const series = metrics.find((m) => c.match(m.name));
    return series && series.points.length > 0 ? [{ ...c, series }] : [];
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (charts.length === 0) {
    return (
      <p className="text-pretty p-4 text-[11px] text-muted-foreground">
        This agent exported no process metrics. Launch it with
        {" "}<code>opentelemetry-instrument</code> and the system-metrics instrumentation installed.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {charts.map((c, i) => (
        <MetricChart key={c.title} series={c.series} title={c.title} unit={c.unit} color={COLORS[i % COLORS.length]} />
      ))}
    </div>
  );
}
