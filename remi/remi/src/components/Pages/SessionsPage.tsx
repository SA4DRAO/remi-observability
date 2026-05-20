/**
 * SessionsPage — lists V2 OTLP sessions with filters, stats, and pagination.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  DollarSign,
  Hash,
  RotateCw,
} from "lucide-react";
import { useSessions } from "../../hooks/useSessions";
import { formatDistanceToNow } from "../../utils/date-utils";
import type { SessionV2 } from "../../types/v2";
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

const PAGE_SIZE = 20;

interface SessionsPageProps {
  onSelectSession: (sessionId: string, name: string | null) => void;
  selectedOrgId: string | null;
  selectedAgentId: string | null;
  onChangeOrgId: (orgId: string | null) => void;
  onChangeAgentId: (agentId: string | null) => void;
}

function formatCost(cost: string | number): string {
  const n = parseFloat(String(cost));
  if (isNaN(n)) return "$0.0000";
  return n > 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
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

interface SessionRowProps {
  session: SessionV2;
  onClick: () => void;
}

function StatusBadge({ session }: { session: SessionV2 }) {
  if (session.is_complete) {
    return (
      <Badge
        variant="outline"
        className="border-green-300 px-1.5 py-0 text-[10px] text-green-600 dark:border-green-700 dark:text-green-400"
      >
        <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" />
        Complete
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-blue-300 px-1.5 py-0 text-[10px] text-blue-600 dark:border-blue-700 dark:text-blue-400"
    >
      <Clock className="mr-0.5 h-2.5 w-2.5" />
      Running
    </Badge>
  );
}

function SessionRow({ session, onClick }: SessionRowProps) {
  const shortId = session.session_id.length > 16
    ? `${session.session_id.slice(0, 8)}…${session.session_id.slice(-6)}`
    : session.session_id;

  return (
    <TableRow className="group cursor-pointer" onClick={onClick}>
      <TableCell className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-mono text-xs text-foreground truncate max-w-[180px]"
            title={session.session_id}
          >
            {shortId}
          </span>
          <div className="flex flex-wrap gap-1">
            <StatusBadge session={session} />
            {session.has_error && (
              <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                error
              </Badge>
            )}
          </div>
        </div>
      </TableCell>

      <TableCell className="px-4 py-3">
        <span className="font-mono text-xs text-muted-foreground truncate max-w-[120px]" title={session.agent_id}>
          {session.agent_id || "—"}
        </span>
      </TableCell>

      <TableCell className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {formatDistanceToNow(session.created_at)}
      </TableCell>

      <TableCell className="px-4 py-3 text-center tabular-nums text-sm">
        {session.total_events}
      </TableCell>

      <TableCell className="px-4 py-3 text-center tabular-nums text-sm">
        {session.llm_calls}
      </TableCell>

      <TableCell className="px-4 py-3 text-right tabular-nums text-sm">
        {session.total_tokens.toLocaleString()}
      </TableCell>

      <TableCell className="px-4 py-3 text-right tabular-nums text-sm font-medium">
        {formatCost(session.estimated_cost_usd)}
      </TableCell>

      <TableCell className="w-8 px-2 py-3">
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </TableCell>
    </TableRow>
  );
}

export function SessionsPage({
  onSelectSession,
  selectedOrgId,
  selectedAgentId,
  onChangeOrgId,
  onChangeAgentId,
}: SessionsPageProps) {
  const [orgInput, setOrgInput] = useState(selectedOrgId ?? "");
  const [agentInput, setAgentInput] = useState(selectedAgentId ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hasErrorFilter, setHasErrorFilter] = useState<boolean | undefined>(undefined);
  const [isCompleteFilter, setIsCompleteFilter] = useState<boolean | undefined>(undefined);
  const [page, setPage] = useState(0);

  // Applied (committed) filter state
  const [appliedOrg, setAppliedOrg] = useState(selectedOrgId ?? "");
  const [appliedAgent, setAppliedAgent] = useState(selectedAgentId ?? "");
  const [appliedStart, setAppliedStart] = useState("");
  const [appliedEnd, setAppliedEnd] = useState("");
  const [appliedHasError, setAppliedHasError] = useState<boolean | undefined>(undefined);
  const [appliedIsComplete, setAppliedIsComplete] = useState<boolean | undefined>(undefined);

  const { sessions, total, isPending, isFetching, error, refetch } = useSessions({
    org_id: appliedOrg || undefined,
    agent_id: appliedAgent || undefined,
    start_date: appliedStart || undefined,
    end_date: appliedEnd || undefined,
    has_error: appliedHasError,
    is_complete: appliedIsComplete,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const applyFilters = () => {
    const org = orgInput.trim() || "";
    const agent = agentInput.trim() || "";
    setAppliedOrg(org);
    setAppliedAgent(agent);
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
    setAppliedHasError(hasErrorFilter);
    setAppliedIsComplete(isCompleteFilter);
    onChangeOrgId(org || null);
    onChangeAgentId(agent || null);
    setPage(0);
  };

  const clearFilters = () => {
    setOrgInput("");
    setAgentInput("");
    setStartDate("");
    setEndDate("");
    setHasErrorFilter(undefined);
    setIsCompleteFilter(undefined);
    setAppliedOrg("");
    setAppliedAgent("");
    setAppliedStart("");
    setAppliedEnd("");
    setAppliedHasError(undefined);
    setAppliedIsComplete(undefined);
    onChangeOrgId(null);
    onChangeAgentId(null);
    setPage(0);
  };

  const hasActiveFilters = !!(
    appliedOrg || appliedAgent || appliedStart || appliedEnd ||
    appliedHasError !== undefined || appliedIsComplete !== undefined
  );

  // Summary stats from current page
  const totalTokens = sessions.reduce((s, sess) => s + sess.total_tokens, 0);
  const totalCostNum = sessions.reduce((s, sess) => s + parseFloat(sess.estimated_cost_usd), 0);
  const totalErrors = sessions.reduce((s, sess) => s + sess.error_count, 0);
  const completedCount = sessions.filter((s) => s.is_complete).length;

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
          <p className="text-sm text-muted-foreground">
            OTLP trace sessions from instrumented LLM applications
          </p>
        </div>
        <Button
          onClick={() => refetch()}
          disabled={isFetching}
          variant="outline"
          size="sm"
        >
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

          {/* Boolean toggles */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Show:</span>
            {[
              { label: "Has Error", value: true as const, field: "hasError" as const },
              { label: "No Error", value: false as const, field: "hasError" as const },
              { label: "Complete", value: true as const, field: "isComplete" as const },
              { label: "Running", value: false as const, field: "isComplete" as const },
            ].map(({ label, value, field }) => {
              const isActive =
                field === "hasError" ? hasErrorFilter === value : isCompleteFilter === value;
              return (
                <Button
                  key={`${field}-${String(value)}`}
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => {
                    if (field === "hasError") {
                      setHasErrorFilter(isActive ? undefined : value);
                    } else {
                      setIsCompleteFilter(isActive ? undefined : value);
                    }
                  }}
                >
                  {label}
                </Button>
              );
            })}

            <div className="ml-auto flex items-center gap-2">
              <Button onClick={applyFilters} size="sm">
                Apply
              </Button>
              <Button onClick={clearFilters} disabled={!hasActiveFilters} variant="outline" size="sm">
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Sessions"
          value={total.toLocaleString()}
          icon={<Hash className="h-5 w-5" />}
          subtext={`${completedCount} completed on this page`}
        />
        <StatCard
          label="Total Tokens"
          value={totalTokens.toLocaleString()}
          icon={<Cpu className="h-5 w-5" />}
          subtext="across visible sessions"
        />
        <StatCard
          label="Total Cost"
          value={formatCost(totalCostNum)}
          icon={<DollarSign className="h-5 w-5" />}
        />
        <StatCard
          label="Errors"
          value={totalErrors}
          icon={<Activity className="h-5 w-5" />}
          subtext={totalErrors === 0 ? "No errors" : `${totalErrors} span error(s)`}
        />
      </div>

      {/* Sessions table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Sessions</CardTitle>
              <CardDescription>
                {isPending
                  ? "Loading…"
                  : `${total.toLocaleString()} session${total !== 1 ? "s" : ""} total`}
              </CardDescription>
            </div>
            {total > PAGE_SIZE && (
              <Badge variant="outline" className="font-mono text-xs">
                Page {page + 1} / {totalPages}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {isPending ? (
            <div className="space-y-2 px-4 py-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Activity className="mx-auto mb-3 h-10 w-10 opacity-40" />
              <p className="font-medium">No sessions</p>
              <p className="mt-1 text-sm">
                {hasActiveFilters
                  ? "No sessions match the current filters."
                  : "Sessions will appear here as agents run."}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4">Session ID</TableHead>
                    <TableHead className="px-4">Agent</TableHead>
                    <TableHead className="px-4">Created</TableHead>
                    <TableHead className="px-4 text-center">Spans</TableHead>
                    <TableHead className="px-4 text-center">LLM</TableHead>
                    <TableHead className="px-4 text-right">Tokens</TableHead>
                    <TableHead className="px-4 text-right">Cost</TableHead>
                    <TableHead className="w-8 px-2" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <SessionRow
                      key={session.session_id}
                      session={session}
                      onClick={() => onSelectSession(session.session_id, null)}
                    />
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 pt-4 pb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
