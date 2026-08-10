import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Gavel, Loader2 } from "lucide-react";
import { useSampleJudge, useVersionComparison } from "../hooks/useAnalytics";
import { formatBytes, formatLatency } from "../utils/format";
import { Skeleton } from "./ui/skeleton";
import { dateFrom, type Scope } from "../lib/scope";
import type { VersionStats } from "../types";

// Versions are compared PER AGENT: a regression is "same agent, different
// release" — cross-agent comparisons are meaningless (different workloads), so
// each agent gets its own section and its own baseline.

type SortKey =
  | "version" | "sessions" | "error_rate" | "avg_llm_latency_ms" | "p95_llm_latency_ms"
  | "total_tokens" | "avg_cpu_pct" | "max_rss_bytes" | "avg_correctness";

interface DeltaProps {
  value: number | null;
  baseline: number | null;
  lowerIsBetter: boolean;
  /** "pct" = relative %, "pp" = absolute percentage points, "abs" = raw (judge scores) */
  mode: "pct" | "pp" | "abs";
}

/**
 * Regression semantics per metric: for "lower is better" a positive delta vs
 * baseline is a regression; judge scores invert. Text always carries an arrow
 * and the number, so color is never the only signal.
 */
function Delta({ value, baseline, lowerIsBetter, mode }: DeltaProps) {
  if (value == null || baseline == null) return null;
  let delta: number;
  let text: string;
  if (mode === "pct") {
    if (baseline === 0) return null;
    delta = ((value - baseline) / baseline) * 100;
    if (Math.abs(delta) < 3) return <span className="ml-1.5 text-[10px] text-muted-foreground">≈</span>;
    text = `${Math.abs(delta).toFixed(0)}%`;
  } else if (mode === "pp") {
    delta = (value - baseline) * 100;
    if (Math.abs(delta) < 0.5) return <span className="ml-1.5 text-[10px] text-muted-foreground">≈</span>;
    text = `${Math.abs(delta).toFixed(1)}pp`;
  } else {
    delta = value - baseline;
    if (Math.abs(delta) < 0.3) return <span className="ml-1.5 text-[10px] text-muted-foreground">≈</span>;
    text = Math.abs(delta).toFixed(1);
  }
  const worse = lowerIsBetter ? delta > 0 : delta < 0;
  return (
    <span
      className="ml-1.5 text-[10px] font-bold"
      style={{ color: worse ? "var(--err)" : "var(--ok)" }}
    >
      {delta > 0 ? "↑" : "↓"}{text}
    </span>
  );
}

/** One-line summary of the newest release against the chosen baseline. */
function verdictFor(latest: VersionStats, baseline: VersionStats): { text: string; color: string } {
  if (latest.version === baseline.version) return { text: "baseline only", color: "var(--muted-foreground)" };
  const latPct =
    baseline.avg_llm_latency_ms > 0
      ? ((latest.avg_llm_latency_ms - baseline.avg_llm_latency_ms) / baseline.avg_llm_latency_ms) * 100
      : 0;
  const errPp = (latest.error_rate - baseline.error_rate) * 100;
  if (latPct > 10 || errPp > 1) return { text: `${latest.version} regressed`, color: "var(--err)" };
  if (latPct < -10 || errPp < -1) return { text: `${latest.version} improved`, color: "var(--ok)" };
  return { text: `${latest.version} on par`, color: "var(--muted-foreground)" };
}

export function VersionComparison({ scope }: { scope: Scope }) {
  const { versions, isPending } = useVersionComparison(scope.agent || undefined, dateFrom(scope.days));
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
      byAgent.set(v.agent, [...(byAgent.get(v.agent) ?? []), v]);
    }
    return [...byAgent.entries()];
  }, [versions, showUnversioned, search]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
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
    setJudging(`${agent} ${version}`);
    setJudgeError(null);
    try {
      const res = await sampleJudge.mutateAsync({ agent, version });
      if (res.judged === 0) {
        setJudgeError(
          res.candidates === 0
            ? `No unjudged LLM spans left in ${agent} ${version}.`
            : `Judge calls failed for ${agent} ${version} — check the judge model key.`
        );
      }
    } catch (e) {
      setJudgeError(e instanceof Error ? e.message : "Judge request failed");
    } finally {
      setJudging(null);
    }
  };

  const SortHead = ({ label, k, num = true }: { label: string; k: SortKey; num?: boolean }) => (
    <th className={num ? "num" : undefined}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
        {label}
        {sortKey === k ? (
          sortDir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />
        )}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="sect-head">
        <h1 className="m-0 text-base font-bold tracking-tight">Versions</h1>
        <span className="sect-note text-pretty">
          last {scope.days} day{scope.days === 1 ? "" : "s"} · deltas are measured against the baseline release of the
          same agent — red means the newer release regressed
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <input
            className="ctl w-44"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search agent or version"
            aria-label="Search agent or version"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={showUnversioned} onChange={(e) => setShowUnversioned(e.target.checked)} />
            show unversioned
          </label>
        </div>
      </div>

      {judgeError && <p className="text-[11px]" style={{ color: "var(--err)" }}>{judgeError}</p>}

      {isPending && <Skeleton className="h-40 w-full" />}

      {!isPending && agents.length === 0 && (
        <div className="panel px-4 py-12 text-center">
          <p className="text-xs font-medium">
            {versions.length > 0
              ? "No versioned releases in this window"
              : `No traffic in the last ${scope.days} day${scope.days === 1 ? "" : "s"}`}
          </p>
          <p className="mt-1 text-pretty text-[11px] text-muted-foreground">
            {versions.length > 0 ? (
              <>This window only has unversioned traffic — tick “show unversioned”, or widen the range.</>
            ) : (
              <>
                Widen the range, or set <code>OTEL_RESOURCE_ATTRIBUTES=service.version=X</code> on your agent so
                releases can be compared.
              </>
            )}
          </p>
        </div>
      )}

      {agents.map(([agent, rows]) => {
        const baseline = baselineFor(agent, rows);
        const newest = [...rows].sort(
          (a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()
        )[0];
        const verdict = baseline && newest ? verdictFor(newest, baseline) : null;

        return (
          <section key={agent} className="flex flex-col gap-2.5">
            <div className="sect-head">
              <h2 className="sect-title">{agent}</h2>
              <span className="sect-note">
                {rows.length} release{rows.length === 1 ? "" : "s"}
                {baseline && ` · baseline ${baseline.version}`}
              </span>
              {verdict && (
                <span className="ml-auto text-[11px] font-semibold" style={{ color: verdict.color }}>
                  {verdict.text}
                </span>
              )}
            </div>

            <div className="panel overflow-x-auto">
              <table className="dtable">
                <thead>
                  <tr>
                    <th style={{ width: 74 }}>Baseline</th>
                    <SortHead label="Version" k="version" num={false} />
                    <SortHead label="Sessions" k="sessions" />
                    <SortHead label="Error rate" k="error_rate" />
                    <SortHead label="Avg latency" k="avg_llm_latency_ms" />
                    <SortHead label="p95" k="p95_llm_latency_ms" />
                    <SortHead label="Tokens" k="total_tokens" />
                    <SortHead label="CPU" k="avg_cpu_pct" />
                    <SortHead label="Peak RSS" k="max_rss_bytes" />
                    <SortHead label="Judge" k="avg_correctness" />
                    <th style={{ width: 96 }} />
                  </tr>
                </thead>
                <tbody>
                  {sortRows(rows).map((v) => {
                    const isBaseline = baseline?.version === v.version;
                    const b = isBaseline ? null : baseline;
                    return (
                      <tr key={v.version} style={{ background: isBaseline ? "var(--subtle)" : undefined }}>
                        <td>
                          <input
                            type="radio"
                            name={`baseline-${agent}`}
                            aria-label={`Set ${v.version} as ${agent} baseline`}
                            checked={isBaseline}
                            onChange={() => setBaselines({ ...baselines, [agent]: v.version })}
                          />
                        </td>
                        <td className="font-bold">{v.version}</td>
                        <td className="num">{v.sessions.toLocaleString()}</td>
                        <td className="num">
                          {(v.error_rate * 100).toFixed(1)}%
                          <Delta value={v.error_rate} baseline={b?.error_rate ?? null} lowerIsBetter mode="pp" />
                        </td>
                        <td className="num">
                          {formatLatency(v.avg_llm_latency_ms)}
                          <Delta value={v.avg_llm_latency_ms} baseline={b?.avg_llm_latency_ms ?? null} lowerIsBetter mode="pct" />
                        </td>
                        <td className="num dim">
                          {formatLatency(v.p95_llm_latency_ms)}
                          <Delta value={v.p95_llm_latency_ms} baseline={b?.p95_llm_latency_ms ?? null} lowerIsBetter mode="pct" />
                        </td>
                        <td className="num">{v.total_tokens.toLocaleString()}</td>
                        <td className="num">
                          {v.avg_cpu_pct != null ? `${v.avg_cpu_pct.toFixed(1)}%` : "—"}
                          <Delta value={v.avg_cpu_pct} baseline={b?.avg_cpu_pct ?? null} lowerIsBetter mode="pct" />
                        </td>
                        <td className="num">
                          {formatBytes(v.max_rss_bytes)}
                          <Delta value={v.max_rss_bytes} baseline={b?.max_rss_bytes ?? null} lowerIsBetter mode="pct" />
                        </td>
                        <td className="num">
                          {v.avg_correctness != null ? (
                            <>
                              {v.avg_correctness}/10
                              <Delta value={v.avg_correctness} baseline={b?.avg_correctness ?? null} lowerIsBetter={false} mode="abs" />
                              <span className="ml-1 text-[10px] text-muted-foreground">({v.verdicts})</span>
                            </>
                          ) : "—"}
                        </td>
                        <td className="num">
                          <button
                            className="ctl ctl-sm"
                            disabled={judging !== null}
                            onClick={() => runJudge(agent, v.version)}
                          >
                            {judging === `${agent} ${v.version}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Gavel className="h-3 w-3" />
                            )}
                            Judge 3
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
