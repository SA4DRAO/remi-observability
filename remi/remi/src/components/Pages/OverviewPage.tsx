import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAnalytics, useVersionComparison } from "../../hooks/useAnalytics";
import { useSessions } from "../../hooks/useSessions";
import { deriveAttention, type AttentionItem } from "../../utils/attention";
import { formatCompact, formatDuration, formatLatency, shortId, statusColor } from "../../utils/format";
import { formatDistanceToNow } from "../../utils/date-utils";
import { AXIS_TICK, GRID, TOOLTIP_STYLE, shortDate } from "../../lib/chart";
import { dateFrom, type Scope } from "../../lib/scope";
import { Skeleton } from "../ui/skeleton";
import type { Analytics, DailyStats, VersionStats } from "../../types";

const SEVERITY_COLOR = { err: "var(--err)", warn: "var(--warn)", info: "var(--info)" } as const;

interface OverviewPageProps {
  scope: Scope;
  onFollow: (item: AttentionItem) => void;
  onSelectSession: (sessionId: string) => void;
  onNavigate: (page: "sessions" | "analytics" | "versions") => void;
}

/**
 * Trend for a headline number: this window's second half against its first.
 * The API exposes no previous-period rollup, so the split is the honest
 * comparison available — the label says so.
 */
function halfOverHalf(daily: DailyStats[], pick: (d: DailyStats) => number): number | null {
  if (daily.length < 4) return null;
  const mid = Math.floor(daily.length / 2);
  const mean = (rows: DailyStats[]) => rows.reduce((sum, d) => sum + pick(d), 0) / rows.length;
  const before = mean(daily.slice(0, mid));
  const after = mean(daily.slice(mid));
  if (before === 0) return null;
  return ((after - before) / before) * 100;
}

function Delta({ pct, lowerIsBetter = false }: { pct: number | null; lowerIsBetter?: boolean }) {
  if (pct == null || Math.abs(pct) < 3) return null;
  const worse = lowerIsBetter ? pct > 0 : pct < 0;
  return (
    <span
      className="text-[11px] font-semibold"
      style={{ color: worse ? "var(--err)" : "var(--ok)" }}
      title="second half of the window vs the first"
    >
      {pct > 0 ? "↑" : "↓"}{Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function Headline({ analytics }: { analytics: Analytics | null }) {
  const daily = analytics?.daily ?? [];
  const t = analytics?.totals;
  const days = Math.max(1, daily.length);

  const cells = [
    {
      label: `sessions · ${days}d`,
      value: t ? t.sessions.toLocaleString() : "—",
      delta: <Delta pct={halfOverHalf(daily, (d) => d.sessions)} />,
      sub: t ? `${Math.round(t.sessions / days)}/day average` : "",
      color: "var(--foreground)",
    },
    {
      label: "error rate",
      value: t ? `${(t.error_rate * 100).toFixed(1)}%` : "—",
      delta: <Delta pct={halfOverHalf(daily, (d) => d.errors)} lowerIsBetter />,
      sub: t ? `${t.error_sessions} session${t.error_sessions === 1 ? "" : "s"} failed` : "",
      color: t && t.error_rate > 0.02 ? "var(--err)" : "var(--foreground)",
    },
    {
      label: "avg llm latency",
      value: t ? formatLatency(t.avg_llm_latency_ms) : "—",
      delta: <Delta pct={halfOverHalf(daily, (d) => d.avg_llm_latency_ms)} lowerIsBetter />,
      sub: t ? `p95 ${formatLatency(t.p95_llm_latency_ms)}` : "",
      color: "var(--foreground)",
    },
    {
      label: "llm calls",
      value: t ? t.llm_calls.toLocaleString() : "—",
      delta: <Delta pct={halfOverHalf(daily, (d) => d.llm_calls)} />,
      sub: analytics ? `${analytics.models.length} model${analytics.models.length === 1 ? "" : "s"} in use` : "",
      color: "var(--foreground)",
    },
    {
      label: "tokens",
      value: t ? formatCompact(t.input_tokens + t.output_tokens) : "—",
      delta: <Delta pct={halfOverHalf(daily, (d) => d.input_tokens + d.output_tokens)} />,
      sub: t ? `${formatCompact(t.input_tokens)} in · ${formatCompact(t.output_tokens)} out` : "",
      color: "var(--foreground)",
    },
  ];

  return (
    <div className="panel grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      {cells.map((c, i) => (
        <div key={c.label} className="px-4 pb-3.5 pt-3" style={{ borderLeft: i === 0 ? undefined : "1px solid var(--border)" }}>
          <div className="kicker">{c.label}</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[22px] font-bold tabular-nums tracking-tight" style={{ color: c.color }}>
              {c.value}
            </span>
            {c.delta}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

/** Latest release per agent, so the agent table can show a version and a trend. */
function latestVersions(versions: VersionStats[]): Map<string, { latest: VersionStats; prev?: VersionStats }> {
  const byAgent = new Map<string, VersionStats[]>();
  for (const v of versions) {
    if (v.version === "unversioned") continue;
    byAgent.set(v.agent, [...(byAgent.get(v.agent) ?? []), v]);
  }
  const out = new Map<string, { latest: VersionStats; prev?: VersionStats }>();
  for (const [agent, list] of byAgent) {
    const sorted = [...list].sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());
    out.set(agent, { latest: sorted[0], prev: sorted[1] });
  }
  return out;
}

export function OverviewPage({ scope, onFollow, onSelectSession, onNavigate }: OverviewPageProps) {
  const { analytics, isPending } = useAnalytics({
    agent_id: scope.agent || undefined,
    date_from: dateFrom(scope.days),
    days: scope.days,
  });
  const { versions } = useVersionComparison(scope.agent || undefined, dateFrom(scope.days));
  const { sessions, total } = useSessions({
    agent_id: scope.agent || undefined,
    date_from: dateFrom(scope.days),
    status: scope.status || undefined,
    limit: 8,
  });

  const attention = useMemo(
    () => deriveAttention(analytics, versions, sessions),
    [analytics, versions, sessions]
  );
  const versionByAgent = useMemo(() => latestVersions(versions), [versions]);

  const daily = analytics?.daily ?? [];
  const agents = analytics?.agents ?? [];
  const maxDuration = Math.max(1, ...sessions.map((s) => s.duration_ms ?? 0));

  return (
    <div className="flex flex-col gap-7">
      <Headline analytics={analytics} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col gap-2.5">
          <div className="sect-head">
            <h2 className="sect-title">Throughput</h2>
            <span className="sect-note">sessions per day · error spans overlaid</span>
            <span className="ml-auto flex gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-1)" }} />sessions
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: "var(--chart-err)" }} />errors
              </span>
            </span>
          </div>
          <div className="panel h-[210px] px-3 pb-2 pt-3.5">
            {isPending ? (
              <Skeleton className="h-full w-full" />
            ) : daily.length === 0 ? (
              <p className="pt-16 text-center text-[11px] text-muted-foreground">No sessions in this window.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 4, right: 4, left: -22, bottom: 0 }} barGap={2}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                  <Bar dataKey="sessions" name="sessions" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="errors" name="errors" fill="var(--chart-err)" radius={[3, 3, 0, 0]} maxBarSize={8} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-2.5">
          <div className="sect-head">
            <h2 className="sect-title">Needs attention</h2>
            <span className="sect-note">{attention.length} item{attention.length === 1 ? "" : "s"}</span>
          </div>
          <div className="panel rowlist">
            {attention.length === 0 ? (
              <p className="px-4 py-8 text-center text-[11px] text-muted-foreground">
                Nothing regressed, failed, or stalled in this window.
              </p>
            ) : (
              attention.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onFollow(item)}
                  className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted"
                >
                  <span className="dot mt-1" style={{ background: SEVERITY_COLOR[item.severity] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{item.title}</span>
                    <span className="mt-0.5 block text-pretty text-[11px] text-muted-foreground">{item.detail}</span>
                  </span>
                  {item.at && (
                    <span className="mt-0.5 whitespace-nowrap text-[10px] text-muted-foreground">
                      {formatDistanceToNow(item.at)}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-2.5">
        <div className="sect-head">
          <h2 className="sect-title">Agents</h2>
          <span className="sect-note">health by service · last {scope.days} day{scope.days === 1 ? "" : "s"}</span>
          <button className="ml-auto text-[11px] text-muted-foreground hover:text-foreground" onClick={() => onNavigate("analytics")}>
            full analytics →
          </button>
        </div>
        <div className="panel overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Version</th>
                <th className="num">Sessions</th>
                <th style={{ width: 150 }}>Error rate</th>
                <th className="num">Avg latency</th>
                <th className="num">p95</th>
                <th className="num">Tokens</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 && (
                <tr><td colSpan={8} className="dim py-8 text-center">No agent activity in this window.</td></tr>
              )}
              {agents.map((a) => {
                const errRate = a.sessions > 0 ? (a.errors / a.sessions) * 100 : 0;
                const errColor = errRate >= 8 ? "var(--err)" : errRate >= 5 ? "var(--warn)" : "var(--muted-foreground)";
                const rel = versionByAgent.get(a.agent);
                const latPct = rel?.prev && rel.prev.avg_llm_latency_ms > 0
                  ? ((rel.latest.avg_llm_latency_ms - rel.prev.avg_llm_latency_ms) / rel.prev.avg_llm_latency_ms) * 100
                  : null;
                return (
                  <tr key={a.agent}>
                    <td className="font-semibold">{a.agent}</td>
                    <td className="dim text-[11px]">{rel?.latest.version ?? "—"}</td>
                    <td className="num">{a.sessions.toLocaleString()}</td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className="bar">
                          <span style={{ width: `${Math.min(100, errRate * 8)}%`, background: errColor }} />
                        </span>
                        <span className="w-9 text-right text-[11px] tabular-nums" style={{ color: errColor }}>
                          {errRate.toFixed(1)}%
                        </span>
                      </span>
                    </td>
                    <td className="num">{formatLatency(a.avg_llm_latency_ms)}</td>
                    <td className="num dim">{rel ? formatLatency(rel.latest.p95_llm_latency_ms) : "—"}</td>
                    <td className="num dim">{formatCompact(a.total_tokens)}</td>
                    <td className="num">
                      {latPct != null && Math.abs(latPct) >= 10 ? (
                        <span className="text-[10px]" style={{ color: latPct > 0 ? "var(--err)" : "var(--ok)" }}>
                          latency {latPct > 0 ? "↑" : "↓"}{Math.abs(latPct).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">stable</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="sect-head">
          <h2 className="sect-title">Latest runs</h2>
          <span className="sect-note">streaming</span>
          <button className="ml-auto text-[11px] text-muted-foreground hover:text-foreground" onClick={() => onNavigate("sessions")}>
            all {total.toLocaleString()} sessions →
          </button>
        </div>
        <div className="panel rowlist">
          {isPending && sessions.length === 0 && (
            <div className="space-y-1.5 p-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          )}
          {sessions.map((s) => (
            <button
              key={s.session_id}
              onClick={() => onSelectSession(s.session_id)}
              className="flex w-full items-center gap-3.5 px-4 py-2 text-left hover:bg-muted"
            >
              <span className="dot" style={{ background: statusColor(s.status) }} />
              <span className="w-[130px] shrink-0 text-[11px] text-muted-foreground">{shortId(s.session_id)}</span>
              <span className="w-[150px] shrink-0 truncate text-xs font-semibold">{s.agent_id ?? "—"}</span>
              <span className="hidden w-[130px] shrink-0 truncate text-[11px] text-muted-foreground md:block">
                {s.primary_model ?? "—"}
              </span>
              <span className="bar hidden sm:block">
                <span
                  style={{
                    width: `${Math.min(100, ((s.duration_ms ?? 0) / maxDuration) * 100)}%`,
                    background: s.status === "error" ? "var(--chart-err)" : s.status === "running" ? "var(--info)" : "var(--chart-1)",
                  }}
                />
              </span>
              <span className="w-14 shrink-0 text-right text-[11px] tabular-nums">
                {s.status === "running" ? "—" : formatDuration(s.duration_ms)}
              </span>
              <span className="w-[66px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {s.total_tokens.toLocaleString()}
              </span>
              <span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground">
                {formatDistanceToNow(s.started_at)}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
