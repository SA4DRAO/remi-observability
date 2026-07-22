import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSystemMetrics } from "../hooks/useSystemMetrics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import type { SystemMetricSeries } from "../types";

// Which emitted metrics get a chart, and how to render their values.
// Everything else the agent exports is still queryable via the API.
// system.cpu.* is emitted per-core (16 interleaved series) so it isn't charted;
// process-level metrics describe the agent itself.
const CHARTED: Array<{ match: (name: string) => boolean; title: string; unit: "percent" | "bytes" }> = [
  { match: (n) => n.startsWith("process.cpu.utilization") || n.startsWith("process.runtime.cpython.cpu.utilization"), title: "Process CPU", unit: "percent" },
  { match: (n) => n.startsWith("process.memory.usage") || n.startsWith("process.runtime.cpython.memory (rss)"), title: "Process Memory (RSS)", unit: "bytes" },
  { match: (n) => n.startsWith("process.memory.virtual"), title: "Process Memory (virtual)", unit: "bytes" },
  { match: (n) => n.startsWith("system.memory.utilization (used)"), title: "System Memory (used)", unit: "percent" },
];

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

function formatValue(v: number, unit: "percent" | "bytes"): string {
  if (unit === "percent") return `${(v * 100).toFixed(1)}%`;
  if (v >= 1 << 30) return `${(v / (1 << 30)).toFixed(2)} GiB`;
  if (v >= 1 << 20) return `${(v / (1 << 20)).toFixed(1)} MiB`;
  return `${Math.round(v / 1024)} KiB`;
}

function timeLabel(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

function MetricChart({ series, title, unit }: { series: SystemMetricSeries; title: string; unit: "percent" | "bytes" }) {
  const data = series.points.map((p) => ({ ts: p.ts, value: p.value }));
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="ts" tickFormatter={timeLabel}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false}
              axisLine={{ stroke: "var(--border)" }} minTickGap={40} />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => formatValue(v, unit)} width={70} />
            <Tooltip contentStyle={TOOLTIP_STYLE}
              labelFormatter={(l) => timeLabel(String(l))}
              formatter={(value) => [formatValue(Number(value), unit), title]} />
            <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2}
              fill="var(--chart-1)" fillOpacity={0.12} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function SystemMetricsPanel({ sessionId }: { sessionId: string }) {
  const { metrics, isPending } = useSystemMetrics(sessionId);

  const charts = CHARTED
    .map((c) => {
      const series = metrics.find((m) => c.match(m.name));
      return series && series.points.length > 0 ? { ...c, series } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (!isPending && charts.length === 0) return null; // agent didn't export system metrics

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">System Metrics</CardTitle>
        <CardDescription>
          CPU and memory of the agent process during this session (OTLP metrics)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {charts.map((c) => (
              <MetricChart key={c.title} series={c.series} title={c.title} unit={c.unit} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
