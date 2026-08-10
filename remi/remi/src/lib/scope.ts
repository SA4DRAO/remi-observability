/** The filter every page reads: which agent, how far back, which status. */
export interface Scope {
  /** "" = all agents */
  agent: string;
  /** trailing window in days, drives both the sessions and analytics queries */
  days: number;
  /** "" = any status */
  status: "" | "complete" | "running" | "error";
}

export const DEFAULT_SCOPE: Scope = { agent: "", days: 7, status: "" };

export const RANGES = [
  { days: 1, label: "last 24 hours" },
  { days: 7, label: "last 7 days" },
  { days: 30, label: "last 30 days" },
] as const;

export const STATUSES = [
  { value: "", label: "all" },
  { value: "complete", label: "complete" },
  { value: "running", label: "running" },
  { value: "error", label: "error" },
] as const;

/** `days` → an ISO date the API accepts as `date_from`. */
export function dateFrom(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
