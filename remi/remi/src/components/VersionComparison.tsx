import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Gavel, Loader2 } from "lucide-react";
import { useSampleJudge, useVersionComparison } from "../hooks/useAnalytics";
import { formatBytes, formatLatency } from "../utils/format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import type { VersionStats } from "../types";

// Versions are compared PER AGENT: a regression is "same agent, different
// release" — cross-agent comparisons are meaningless (different workloads), so
// each agent gets its own section and its own baseline.

// Regression semantics per metric: for "lower is better" a positive delta vs
// baseline is a regression; judge scores invert. Text always carries the sign
// and an arrow, so color is never the only signal.
const WORSE = "text-red-600 dark:text-red-400";
const BETTER = "text-emerald-600 dark:text-emerald-400";

type SortKey =
  | "version" | "sessions" | "error_rate" | "avg_llm_latency_ms" | "p95_llm_latency_ms"
  | "total_tokens" | "avg_cpu_pct" | "max_rss_bytes" | "avg_correctness";

interface DeltaProps {
  value: number | null;
  baseline: number | null;
  lowerIsBetter: boolean;
  /** "pct" = relative %, "pp" = absolute percentage points, "abs" = absolute (judge scores) */
  mode: "pct" | "pp" | "abs";
}

function Delta({ value, baseline, lowerIsBetter, mode }: DeltaProps) {
  if (value == null || baseline == null) return null;
  let delta: number;
  let text: string;
  if (mode === "pct") {
    if (baseline === 0) return null;
    delta = ((value - baseline) / baseline) * 100;
    if (Math.abs(delta) < 3) return <span className="ml-1 text-xs text-muted-foreground">≈</span>;
    text = `${Math.abs(delta).toFixed(0)}%`;
  } else if (mode === "pp") {
    delta = (value - baseline) * 100;
    if (Math.abs(delta) < 0.5) return <span className="ml-1 text-xs text-muted-foreground">≈</span>;
    text = `${Math.abs(delta).toFixed(1)}pp`;
  } else {
    delta = value - baseline;
    if (Math.abs(delta) < 0.3) return <span className="ml-1 text-xs text-muted-foreground">≈</span>;
    text = Math.abs(delta).toFixed(1);
  }
  const isWorse = lowerIsBetter ? delta > 0 : delta < 0;
  const Arrow = delta > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`ml-1 inline-flex items-center text-xs font-medium ${isWorse ? WORSE : BETTER}`}>
      <Arrow className="h-3 w-3" />
      {text}
    </span>
  );
}

export function VersionComparison({ agentId }: { agentId?: string }) {
  const { versions } = useVersionComparison(agentId);
  const sampleJudge = useSampleJudge();
  const [judging, setJudging] = useState<string | null>(null);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showUnversioned, setShowUnversioned] = useState(false);
  // baseline pick per agent: { [agent]: version }
  const [baselines, setBaselines] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Group by agent, preserving backend order (agent asc, last_seen desc).
  const agents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byAgent = new Map<string, VersionStats[]>();
    for (const v of versions) {
      if (!showUnversioned && v.version === "unversioned") continue;
      if (q && !v.version.toLowerCase().includes(q) && !v.agent.toLowerCase().includes(q)) continue;
      const list = byAgent.get(v.agent) ?? [];
      list.push(v);
      byAgent.set(v.agent, list);
    }
    // Only agents with ≥2 rows have anything to compare; single-version agents
    // still render so a fresh rollout is visible next to nothing-yet.
    return [...byAgent.entries()];
  }, [versions, showUnversioned, search]);

  if (versions.length === 0) return null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortRows = (rows: VersionStats[]) => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  };

  const baselineFor = (agent: string, rows: VersionStats[]): VersionStats | null => {
    const named = rows.filter((v) => v.version !== "unversioned");
    const pool = named.length > 0 ? named : rows;
    return pool.find((v) => v.version === baselines[agent]) ?? pool[0] ?? null;
  };

  const runJudge = async (agent: string, version: string) => {
    const key = `${agent} ${version}`;
    setJudging(key);
    setJudgeError(null);
    try {
      const res = await sampleJudge.mutateAsync({ agent, version });
      if (res.judged === 0) {
        setJudgeError(
          res.candidates === 0
            ? `No unjudged LLM spans left in ${agent} ${version}.`
            : `Judge calls failed for ${agent} ${version} — check the judge model key.`,
        );
      }
    } catch (e) {
      setJudgeError(e instanceof Error ? e.message : "Judge request failed");
    } finally {
      setJudging(null);
    }
  };

  const SortHead = ({ label, k, className = "" }: { label: string; k: SortKey; className?: string }) => (
    <TableHead className={`px-3 ${className}`}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {sortKey === k
          ? sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
          : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TableHead>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">Version Comparison</CardTitle>
            <CardDescription>
              Per agent — deltas vs that agent's baseline (radio selects it); red = regression
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agent or version"
              className="h-8 w-48"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showUnversioned}
                onChange={(e) => setShowUnversioned(e.target.checked)}
              />
              show unversioned
            </label>
          </div>
        </div>
        {judgeError && <p className="text-xs text-red-600 dark:text-red-400">{judgeError}</p>}
      </CardHeader>
      <CardContent className="space-y-6 overflow-x-auto p-0 pb-4">
        {agents.map(([agent, rows]) => {
          const baseline = baselineFor(agent, rows);
          return (
            <div key={agent}>
              <div className="border-b bg-muted/30 px-4 py-2">
                <Badge variant="outline" className="font-mono text-xs">{agent}</Badge>
                <span className="ml-2 text-xs text-muted-foreground">
                  {rows.length} version{rows.length === 1 ? "" : "s"}
                  {baseline && <> · baseline <span className="font-mono">{baseline.version}</span></>}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 px-3" aria-label="Baseline selector" />
                    <SortHead label="Version" k="version" />
                    <SortHead label="Sessions" k="sessions" className="text-right" />
                    <SortHead label="Error Rate" k="error_rate" className="text-right" />
                    <SortHead label="Avg LLM Latency" k="avg_llm_latency_ms" className="text-right" />
                    <SortHead label="p95" k="p95_llm_latency_ms" className="text-right" />
                    <SortHead label="Tokens" k="total_tokens" className="text-right" />
                    <SortHead label="CPU" k="avg_cpu_pct" className="text-right" />
                    <SortHead label="Peak RSS" k="max_rss_bytes" className="text-right" />
                    <SortHead label="Judge" k="avg_correctness" className="text-right" />
                    <TableHead className="px-3 text-right">Quality Sample</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortRows(rows).map((v) => {
                    const isBaseline = baseline?.version === v.version;
                    const b = isBaseline ? null : baseline;
                    const judgeKey = `${agent} ${v.version}`;
                    return (
                      <TableRow key={v.version} className={isBaseline ? "bg-muted/40" : undefined}>
                        <TableCell className="px-3 py-2">
                          <input
                            type="radio"
                            name={`baseline-${agent}`}
                            aria-label={`Set ${v.version} as ${agent} baseline`}
                            checked={isBaseline}
                            onChange={() => setBaselines({ ...baselines, [agent]: v.version })}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant={isBaseline ? "default" : "secondary"} className="font-mono text-xs">
                            {v.version}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-sm">
                          {v.sessions.toLocaleString()}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-sm">
                          <span className={v.error_rate > 0 ? "font-medium" : "text-muted-foreground"}>
                            {(v.error_rate * 100).toFixed(1)}%
                          </span>
                          <Delta value={v.error_rate} baseline={b?.error_rate ?? null} lowerIsBetter mode="pp" />
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-sm">
                          {formatLatency(v.avg_llm_latency_ms)}
                          <Delta value={v.avg_llm_latency_ms} baseline={b?.avg_llm_latency_ms ?? null} lowerIsBetter mode="pct" />
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-sm text-muted-foreground">
                          {formatLatency(v.p95_llm_latency_ms)}
                          <Delta value={v.p95_llm_latency_ms} baseline={b?.p95_llm_latency_ms ?? null} lowerIsBetter mode="pct" />
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-sm">
                          {v.total_tokens.toLocaleString()}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-sm">
                          {v.avg_cpu_pct != null ? `${v.avg_cpu_pct.toFixed(1)}%` : "—"}
                          <Delta value={v.avg_cpu_pct} baseline={b?.avg_cpu_pct ?? null} lowerIsBetter mode="pct" />
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-sm">
                          {formatBytes(v.max_rss_bytes)}
                          <Delta value={v.max_rss_bytes} baseline={b?.max_rss_bytes ?? null} lowerIsBetter mode="pct" />
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-sm">
                          {v.avg_correctness != null ? (
                            <>
                              {v.avg_correctness}/10
                              <Delta value={v.avg_correctness} baseline={b?.avg_correctness ?? null} lowerIsBetter={false} mode="abs" />
                              <span className="ml-1 text-xs text-muted-foreground">({v.verdicts})</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={judging !== null}
                            onClick={() => runJudge(agent, v.version)}
                          >
                            {judging === judgeKey ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <Gavel className="mr-1 h-3 w-3" />
                            )}
                            Judge 3
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
