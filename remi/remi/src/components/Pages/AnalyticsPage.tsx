import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, RotateCw } from "lucide-react";
import { useAnalytics } from "../../hooks/useAnalytics";
import { AXIS_TICK, GRID, TOOLTIP_STYLE, compactTick, shortDate } from "../../lib/chart";
import { formatCompact, formatLatency } from "../../utils/format";
import { dateFrom, type Scope } from "../../lib/scope";
import { Skeleton } from "../ui/skeleton";

export function AnalyticsPage({ scope }: { scope: Scope }) {
  const { analytics, isPending, error, refetch } = useAnalytics({
    agent_id: scope.agent || undefined,
    date_from: dateFrom(scope.days),
    days: scope.days,
  });

  if (error) {
    return (
      <div className="panel flex items-start gap-3 p-4" style={{ borderColor: "var(--err)" }}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--err)" }} />
        <div>
          <p className="text-xs font-semibold">Connection error</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{error.message}</p>
          <button className="ctl mt-3" onClick={() => refetch()}>
            <RotateCw className="h-3 w-3" />Retry
          </button>
        </div>
      </div>
    );
  }

  const t = analytics?.totals;
  const daily = analytics?.daily ?? [];
  const models = analytics?.models ?? [];
  const totalCalls = models.reduce((sum, m) => sum + m.calls, 0);

  const totals = [
    { label: "sessions", value: t ? t.sessions.toLocaleString() : "—", sub: t ? `${t.error_sessions} with errors` : "" },
    { label: "llm calls", value: t ? t.llm_calls.toLocaleString() : "—", sub: `across ${models.length} model${models.length === 1 ? "" : "s"}` },
    { label: "avg latency", value: t ? formatLatency(t.avg_llm_latency_ms) : "—", sub: t ? `p95 ${formatLatency(t.p95_llm_latency_ms)}` : "" },
    { label: "input tokens", value: t ? formatCompact(t.input_tokens) : "—", sub: t ? `${formatCompact(t.cache_tokens)} cached` : "" },
    {
      label: "output tokens",
      value: t ? formatCompact(t.output_tokens) : "—",
      sub: t && t.input_tokens + t.output_tokens > 0
        ? `${((t.output_tokens / (t.input_tokens + t.output_tokens)) * 100).toFixed(0)}% of total`
        : "",
    },
  ];

  return (
    <div className="flex flex-col gap-7">
      <div className="panel grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {totals.map((c, i) => (
          <div key={c.label} className="px-4 pb-3.5 pt-3" style={{ borderLeft: i === 0 ? undefined : "1px solid var(--border)" }}>
            <div className="kicker">{c.label}</div>
            <div className="mt-1.5 text-[22px] font-bold tabular-nums tracking-tight">{c.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-2.5">
          <div className="sect-head">
            <h2 className="sect-title">LLM latency</h2>
            <span className="sect-note">mean span duration per day</span>
          </div>
          <div className="panel h-[200px] px-3 py-3.5">
            {isPending ? (
              <Skeleton className="h-full w-full" />
            ) : daily.length === 0 ? (
              <p className="pt-14 text-center text-[11px] text-muted-foreground">No data in this window.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 4, right: 6, left: -14, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatLatency(v)} width={52} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [formatLatency(Number(v)), "avg latency"]} />
                  <Area type="monotone" dataKey="avg_llm_latency_ms" stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.12} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-2.5">
          <div className="sect-head">
            <h2 className="sect-title">Tokens</h2>
            <span className="sect-note">input vs output per day</span>
            <span className="ml-auto flex gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-1)" }} />input
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-2)" }} />output
              </span>
            </span>
          </div>
          <div className="panel h-[200px] px-3 py-3.5">
            {isPending ? (
              <Skeleton className="h-full w-full" />
            ) : daily.length === 0 ? (
              <p className="pt-14 text-center text-[11px] text-muted-foreground">No data in this window.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 4, right: 6, left: -8, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={compactTick} width={42} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.4 }} formatter={(v) => Number(v).toLocaleString()} />
                  <Bar dataKey="input_tokens" name="input" stackId="t" fill="var(--chart-1)" maxBarSize={26} />
                  <Bar dataKey="output_tokens" name="output" stackId="t" fill="var(--chart-2)" radius={[3, 3, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-2.5">
        <div className="sect-head">
          <h2 className="sect-title">Models</h2>
          <span className="sect-note">volume and latency per model</span>
        </div>
        <div className="panel overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th style={{ width: 220 }}>Share of calls</th>
                <th className="num">Calls</th>
                <th className="num">Input</th>
                <th className="num">Output</th>
                <th className="num">Cached</th>
                <th className="num">Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {models.length === 0 && (
                <tr><td colSpan={8} className="dim py-8 text-center">No LLM spans with model data yet.</td></tr>
              )}
              {models.map((m) => {
                const share = totalCalls > 0 ? (m.calls / totalCalls) * 100 : 0;
                return (
                  <tr key={m.model}>
                    <td className="font-semibold">{m.model}</td>
                    <td className="dim text-[11px]">{m.provider || "—"}</td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className="bar">
                          <span style={{ width: `${share}%`, background: "var(--chart-1)" }} />
                        </span>
                        <span className="w-8 text-right text-[10px] text-muted-foreground">{share.toFixed(0)}%</span>
                      </span>
                    </td>
                    <td className="num">{m.calls.toLocaleString()}</td>
                    <td className="num">{m.input_tokens.toLocaleString()}</td>
                    <td className="num">{m.output_tokens.toLocaleString()}</td>
                    <td className="num dim">{m.cache_tokens > 0 ? m.cache_tokens.toLocaleString() : "—"}</td>
                    <td className="num">{formatLatency(m.avg_latency_ms)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Exact values behind the charts — the charts alone are not readable by
          a screen reader, so the numbers stay reachable one disclosure away. */}
      {daily.length > 0 && (
        <details className="panel">
          <summary className="cursor-pointer bg-subtle px-4 py-2 text-[11px] text-muted-foreground">
            Daily activity table
          </summary>
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Sessions</th>
                  <th className="num">LLM calls</th>
                  <th className="num">Input</th>
                  <th className="num">Output</th>
                  <th className="num">Errors</th>
                  <th className="num">Avg latency</th>
                </tr>
              </thead>
              <tbody>
                {[...daily].reverse().map((d) => (
                  <tr key={d.date}>
                    <td className="text-[11px]">{d.date}</td>
                    <td className="num">{d.sessions.toLocaleString()}</td>
                    <td className="num">{d.llm_calls.toLocaleString()}</td>
                    <td className="num">{d.input_tokens.toLocaleString()}</td>
                    <td className="num">{d.output_tokens.toLocaleString()}</td>
                    <td className="num" style={{ color: d.errors > 0 ? "var(--err)" : undefined }}>{d.errors}</td>
                    <td className="num">{formatLatency(d.avg_llm_latency_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
