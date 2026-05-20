/**
 * AnalyticsPage — V2 cross-session analytics: summary stats, model breakdown, error rate.
 */

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Cpu,
  DollarSign,
  GitBranch,
  Hash,
  RotateCw,
  TrendingUp,
} from "lucide-react";
import { useAnalytics } from "../../hooks/useAnalytics";
import { useVersionMetrics } from "../../hooks/useVersionMetrics";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

function formatCost(cost: string | number | null | undefined): string {
  if (cost === null || cost === undefined) return "—";
  const n = parseFloat(String(cost));
  if (isNaN(n)) return "—";
  return n > 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

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
            {subtext && (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{subtext}</p>
            )}
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AnalyticsPage() {
  const [orgInput, setOrgInput] = useState("");
  const [agentInput, setAgentInput] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appliedOrg, setAppliedOrg] = useState("");
  const [appliedAgent, setAppliedAgent] = useState("");
  const [appliedStart, setAppliedStart] = useState("");
  const [appliedEnd, setAppliedEnd] = useState("");

  const { analytics, isPending, isFetching, error, refetch } = useAnalytics({
    org_id: appliedOrg || undefined,
    agent_id: appliedAgent || undefined,
    start_date: appliedStart || undefined,
    end_date: appliedEnd || undefined,
  });

  const { versions, isPending: versionsLoading } = useVersionMetrics({
    org_id: appliedOrg || undefined,
    agent_id: appliedAgent || undefined,
  });

  const applyFilters = () => {
    setAppliedOrg(orgInput.trim());
    setAppliedAgent(agentInput.trim());
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
  };

  const clearFilters = () => {
    setOrgInput("");
    setAgentInput("");
    setStartDate("");
    setEndDate("");
    setAppliedOrg("");
    setAppliedAgent("");
    setAppliedStart("");
    setAppliedEnd("");
  };

  const hasActiveFilters = !!(appliedOrg || appliedAgent || appliedStart || appliedEnd);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Connection Error</AlertTitle>
        <AlertDescription className="mt-2">
          {error.message}
          <div className="mt-3">
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RotateCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const errorRatePct = analytics ? (analytics.error_rate * 100).toFixed(1) : "0.0";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Cross-session token usage, costs, and model breakdown
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              value={orgInput}
              onChange={(e) => setOrgInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
              placeholder="Filter by org id"
            />
            <Input
              value={agentInput}
              onChange={(e) => setAgentInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }}
              placeholder="Filter by agent id"
            />
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="Start date"
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="End date"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={applyFilters} size="sm">Apply</Button>
            <Button onClick={clearFilters} disabled={!hasActiveFilters} variant="outline" size="sm">
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isPending ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              label="Total Sessions"
              value={analytics?.total_sessions.toLocaleString() ?? "—"}
              icon={<Hash className="h-5 w-5" />}
              subtext={analytics ? `${analytics.error_sessions} with errors` : undefined}
            />
            <StatCard
              label="Total Tokens"
              value={analytics?.total_tokens.toLocaleString() ?? "—"}
              icon={<Cpu className="h-5 w-5" />}
            />
            <StatCard
              label="Total Cost"
              value={analytics ? formatCost(analytics.total_cost_usd) : "—"}
              icon={<DollarSign className="h-5 w-5" />}
              subtext={
                analytics
                  ? `avg ${formatCost(analytics.avg_cost_per_session)} / session`
                  : undefined
              }
            />
            <StatCard
              label="Error Rate"
              value={`${errorRatePct}%`}
              icon={<TrendingUp className="h-5 w-5" />}
              subtext={
                analytics
                  ? `${analytics.error_sessions} of ${analytics.total_sessions} sessions`
                  : undefined
              }
            />
          </>
        )}
      </div>

      {/* Period info */}
      {analytics && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">
              Showing data for period: <span className="font-medium text-foreground">{analytics.period}</span>
              {" · "}error rate: <span className="font-medium text-foreground">{errorRatePct}%</span>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Version comparison */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Version Comparison</CardTitle>
          </div>
          <CardDescription>
            Average metrics per agent version (from <code className="text-[11px]">service.version</code> OTel resource attribute)
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {versionsLoading ? (
            <div className="space-y-2 px-4 py-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : versions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              <GitBranch className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p>No versioned sessions yet.</p>
              <p className="mt-1 text-xs">
                Set <code className="rounded bg-muted px-1">service.version</code> as an OTel resource attribute in your agent.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Agent</TableHead>
                  <TableHead className="px-4">Version</TableHead>
                  <TableHead className="px-4 text-right">Sessions</TableHead>
                  <TableHead className="px-4 text-right">Avg Tokens</TableHead>
                  <TableHead className="px-4 text-right">Avg Cost</TableHead>
                  <TableHead className="px-4 text-right">Avg Duration</TableHead>
                  <TableHead className="px-4 text-right">Error Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={`${v.agent_id}-${v.agent_version}`}>
                    <TableCell className="px-4 py-2">
                      <span className="font-mono text-xs text-muted-foreground truncate max-w-[120px] block" title={v.agent_id}>
                        {v.agent_id}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-2">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {v.agent_version}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                      {v.session_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                      {Math.round(v.avg_tokens).toLocaleString()}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                      {formatCost(v.avg_cost_usd)}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">
                      {v.avg_duration_ns
                        ? v.avg_duration_ns / 1e9 < 1
                          ? `${Math.round(v.avg_duration_ns / 1e6)}ms`
                          : `${(v.avg_duration_ns / 1e9).toFixed(2)}s`
                        : "—"}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums text-sm">
                      <span className={v.error_rate > 0.05 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
                        {(v.error_rate * 100).toFixed(1)}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
