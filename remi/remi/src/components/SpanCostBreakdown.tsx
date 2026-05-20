/**
 * SpanCostBreakdown — bar chart showing cost and token usage per span in a session.
 */

import { Skeleton } from "./ui/skeleton";
import { Badge } from "./ui/badge";
import { useSessionSpanCosts } from "../hooks/useSessionSpanCosts";

interface SpanCostBreakdownProps {
  sessionId: string;
}

function formatCost(n: number): string {
  if (n === 0) return "—";
  return n > 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`;
}

export function SpanCostBreakdown({ sessionId }: SpanCostBreakdownProps) {
  const { spanCosts, isPending } = useSessionSpanCosts(sessionId);

  if (isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const withCost = spanCosts.filter((s) => s.total_cost_usd > 0);
  const totalCost = withCost.reduce((sum, s) => sum + s.total_cost_usd, 0);

  if (withCost.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No cost data for this session. Cost facts are written after model pricing is matched.
      </p>
    );
  }

  const sorted = [...withCost].sort((a, b) => b.total_cost_usd - a.total_cost_usd);

  return (
    <div className="space-y-2">
      {/* Summary */}
      <div className="flex items-center justify-between pb-2 text-xs text-muted-foreground">
        <span>{sorted.length} spans with cost data</span>
        <span className="font-semibold text-foreground">Total: {formatCost(totalCost)}</span>
      </div>

      {sorted.map((span) => {
        const pct = totalCost > 0 ? (span.total_cost_usd / totalCost) * 100 : 0;
        return (
          <div key={span.span_id} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-mono max-w-[280px]" title={span.span_name}>
                  {span.span_name}
                </span>
                {span.model_name && (
                  <Badge variant="secondary" className="shrink-0 font-mono text-[9px] px-1 py-0">
                    {span.model_name}
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3 tabular-nums">
                <span className="text-muted-foreground">
                  {span.prompt_tokens > 0
                    ? `${span.prompt_tokens.toLocaleString()} in / ${span.completion_tokens.toLocaleString()} out`
                    : ""}
                </span>
                <span className="font-medium">{formatCost(span.total_cost_usd)}</span>
                <span className="w-8 text-right text-muted-foreground">{pct.toFixed(1)}%</span>
              </div>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
