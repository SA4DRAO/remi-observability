import type { VersionStats } from "../types";

// Single source of truth for "is this release worse than that one" — used by
// the overview's attention list and the versions page's per-agent verdict, so
// the two views can't silently disagree on what counts as a regression.
// Deliberately blunt, not a statistical test: tune these two numbers, nothing else.
export const LATENCY_REGRESSION_PCT = 20;
export const ERROR_RATE_REGRESSION_PP = 1;

/** Relative change in avg LLM latency, latest vs baseline, as a percent. */
export function latencyDeltaPct(latest: VersionStats, baseline: VersionStats): number {
  return baseline.avg_llm_latency_ms > 0
    ? ((latest.avg_llm_latency_ms - baseline.avg_llm_latency_ms) / baseline.avg_llm_latency_ms) * 100
    : 0;
}

/** Absolute change in error rate, latest vs baseline, in percentage points. */
export function errorRateDeltaPp(latest: VersionStats, baseline: VersionStats): number {
  return (latest.error_rate - baseline.error_rate) * 100;
}

export function isRegression(latest: VersionStats, baseline: VersionStats): boolean {
  return (
    latencyDeltaPct(latest, baseline) >= LATENCY_REGRESSION_PCT ||
    errorRateDeltaPp(latest, baseline) >= ERROR_RATE_REGRESSION_PP
  );
}

export function isImprovement(latest: VersionStats, baseline: VersionStats): boolean {
  return (
    latencyDeltaPct(latest, baseline) <= -LATENCY_REGRESSION_PCT ||
    errorRateDeltaPp(latest, baseline) <= -ERROR_RATE_REGRESSION_PP
  );
}
