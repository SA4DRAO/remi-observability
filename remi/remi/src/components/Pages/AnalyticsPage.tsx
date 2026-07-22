import { useState } from "react";
import {
  AlertTriangle,
  Cpu,
  Timer,
  Hash,
  RotateCw,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAnalytics } from "../../hooks/useAnalytics";
import { VersionComparison } from "../VersionComparison";
import { formatLatency } from "../../utils/format";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  subtext?: string;
}

function StatCard({ label, value, icon, subtext }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-bold leading-tight sm:text-2xl">{value}</p>
            {subtext && <p className="mt-1 text-xs leading-snug text-muted-foreground">{subtext}</p>}
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Chart tokens come from index.css (--chart-*), stepped per light/dark mode.
const SERIES_1 = "var(--chart-1)";  // blue
const SERIES_2 = "var(--chart-2)";  // aqua
const STATUS_ERR = "var(--chart-err)";

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };

function shortDate(d: string): string {
  return d.slice(5); // YYYY-MM-DD → MM-DD
}

export function AnalyticsPage() {
  const [agentInput,  setAgentInput]  = useState("");
  const [startDate,   setStartDate]   = useState("");
  const [endDate,     setEndDate]     = useState("");
  const [appliedAgent,  setAppliedAgent]  = useState("");
  const [appliedStart,  setAppliedStart]  = useState("");
  const [appliedEnd,    setAppliedEnd]    = useState("");

  const { analytics, isPending, isFetching, error, refetch } = useAnalytics({
    agent_id:  appliedAgent || undefined,
    date_from: appliedStart || undefined,
    date_to:   appliedEnd   || undefined,
  });

  const applyFilters = () => {
    setAppliedAgent(agentInput.trim());
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
  };

  const clearFilters = () => {
    setAgentInput(""); setStartDate(""); setEndDate("");
    setAppliedAgent(""); setAppliedStart(""); setAppliedEnd("");
  };

  const hasActiveFilters = !!(appliedAgent || appliedStart || appliedEnd);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Connection Error</AlertTitle>
        <AlertDescription className="mt-2">
          {error.message}
          <div className="mt-3">
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RotateCw className="mr-2 h-4 w-4" />Retry
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const errorRatePct = analytics ? (analytics.totals.error_rate * 100).toFixed(1) : "0.0";
  const daily = analytics?.daily ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Latency, token usage, and reliability across sessions
          </p>
        </div>
        <Button onClick={() => refetch()} disabled={isFetching} variant="outline" size="sm">
          <RotateCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input value={agentInput} onChange={(e) => setAgentInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
              placeholder="Filter by agent id" />
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="End date" />
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={applyFilters} size="sm">Apply</Button>
            <Button onClick={clearFilters} disabled={!hasActiveFilters} variant="outline" size="sm">Clear</Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isPending ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <StatCard
              label="Total Sessions"
              value={analytics?.totals.sessions.toLocaleString() ?? "—"}
              icon={<Hash className="h-5 w-5" />}
              subtext={analytics ? `${analytics.totals.error_sessions} with errors` : undefined}
            />
            <StatCard
              label="LLM Calls"
              value={analytics?.totals.llm_calls.toLocaleString() ?? "—"}
              icon={<Cpu className="h-5 w-5" />}
              subtext={analytics ? `${analytics.totals.input_tokens.toLocaleString()} input · ${analytics.totals.output_tokens.toLocaleString()} output` : undefined}
            />
            <StatCard
              label="Avg LLM Latency"
              value={analytics ? formatLatency(analytics.totals.avg_llm_latency_ms) : "—"}
              icon={<Timer className="h-5 w-5" />}
              subtext={analytics ? `p95 ${formatLatency(analytics.totals.p95_llm_latency_ms)}` : undefined}
            />
            <StatCard
              label="Error Rate"
              value={`${errorRatePct}%`}
              icon={<TrendingUp className="h-5 w-5" />}
              subtext={analytics ? `${analytics.totals.error_sessions} of ${analytics.totals.sessions} sessions` : undefined}
            />
          </>
        )}
      </div>

      {/* Charts */}
      {daily.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sessions per day</CardTitle>
              <CardDescription>Session volume with error-span counts</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="sessions" name="Sessions" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="errors" name="Error spans" fill={STATUS_ERR} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">LLM latency per day</CardTitle>
              <CardDescription>Mean LLM span duration</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => formatLatency(v)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE}
                    formatter={(value) => [formatLatency(Number(value)), "Avg latency"]} />
                  <Area type="monotone" dataKey="avg_llm_latency_ms" name="Avg latency" stroke={SERIES_1} strokeWidth={2}
                    fill={SERIES_1} fillOpacity={0.12} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tokens per day</CardTitle>
              <CardDescription>Input vs output token volume</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                    formatter={(value) => Number(value).toLocaleString()} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="input_tokens" name="Input" stackId="t" fill={SERIES_1}
                    stroke="var(--background)" strokeWidth={2} maxBarSize={36} />
                  <Bar dataKey="output_tokens" name="Output" stackId="t" fill={SERIES_2}
                    stroke="var(--background)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Daily table (accessible fallback for the charts) */}
      {daily.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daily Activity</CardTitle>
            <CardDescription>Exact values behind the charts</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Date</TableHead>
                  <TableHead className="px-4 text-right">Sessions</TableHead>
                  <TableHead className="px-4 text-right">LLM Calls</TableHead>
                  <TableHead className="px-4 text-right">Input Tokens</TableHead>
                  <TableHead className="px-4 text-right">Output Tokens</TableHead>
                  <TableHead className="px-4 text-right">Errors</TableHead>
                  <TableHead className="px-4 text-right">Avg Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...daily].reverse().map((day) => (
                  <TableRow key={day.date}>
                    <TableCell className="px-4 py-2 font-mono text-xs">{day.date}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{day.sessions.toLocaleString()}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{day.llm_calls.toLocaleString()}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{day.input_tokens.toLocaleString()}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{day.output_tokens.toLocaleString()}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                      <span className={day.errors > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                        {day.errors}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{formatLatency(day.avg_llm_latency_ms)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Model breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Model Breakdown</CardTitle>
          <CardDescription>Token usage and latency per model</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-2 px-4 py-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : !analytics || analytics.models.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No LLM spans with model data yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Model</TableHead>
                  <TableHead className="px-4">Provider</TableHead>
                  <TableHead className="px-4 text-right">Calls</TableHead>
                  <TableHead className="px-4 text-right">Input</TableHead>
                  <TableHead className="px-4 text-right">Output</TableHead>
                  <TableHead className="px-4 text-right">Cached</TableHead>
                  <TableHead className="px-4 text-right">Avg Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.models.map((m) => (
                  <TableRow key={m.model}>
                    <TableCell className="px-4 py-2">
                      <Badge variant="secondary" className="font-mono text-xs">{m.model}</Badge>
                    </TableCell>
                    <TableCell className="px-4 py-2 text-xs text-muted-foreground">{m.provider || "—"}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{m.calls.toLocaleString()}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{m.input_tokens.toLocaleString()}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{m.output_tokens.toLocaleString()}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">
                      {m.cache_tokens > 0 ? m.cache_tokens.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{formatLatency(m.avg_latency_ms)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Agent breakdown */}
      {analytics && analytics.agents.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Agent Breakdown</CardTitle>
            <CardDescription>Sessions, volume, and latency per agent</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Agent</TableHead>
                  <TableHead className="px-4 text-right">Sessions</TableHead>
                  <TableHead className="px-4 text-right">Errors</TableHead>
                  <TableHead className="px-4 text-right">Tokens</TableHead>
                  <TableHead className="px-4 text-right">Avg LLM Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.agents.map((a) => (
                  <TableRow key={a.agent}>
                    <TableCell className="px-4 py-2">
                      <Badge variant="outline" className="font-mono text-xs">{a.agent}</Badge>
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{a.sessions.toLocaleString()}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                      <span className={a.errors > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                        {a.errors}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">{a.total_tokens.toLocaleString()}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">
                      {a.avg_llm_latency_ms > 0 ? formatLatency(a.avg_llm_latency_ms) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Version comparison — regression view across service.version releases */}
      <VersionComparison agentId={appliedAgent || undefined} />
    </div>
  );
}
