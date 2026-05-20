import { Activity, Clock, AlertTriangle, Zap } from "lucide-react";
import { MetricCard, MetricItem } from "./MetricCard";
import type { SessionMetrics } from "../../types/events";

interface SessionMetricsCardsProps {
  metrics: SessionMetrics;
}

export function SessionMetricsCards({ metrics }: SessionMetricsCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Primary Metrics */}
      <MetricCard title="Primary Metrics" icon={<Activity className="h-4 w-4" />}>
        <div className="space-y-3">
          <MetricItem label="Total Events" value={metrics.totalEvents} />
          <MetricItem label="LLM Calls" value={metrics.llmCallCount} />
          <MetricItem label="Tool Calls" value={metrics.toolCallCount} />
          <MetricItem label="Total Tokens" value={metrics.totalTokens.toLocaleString()} />
          <MetricItem label="Estimated Cost" value={`$${metrics.totalCost.toFixed(6)}`} />
        </div>
      </MetricCard>

      {/* Performance Analytics */}
      <MetricCard title="Performance" icon={<Clock className="h-4 w-4" />}>
        <div className="space-y-3">
          <MetricItem label="Total Duration" value={`${Math.round(metrics.totalDuration)}ms`} />
          <MetricItem label="Avg LLM Time" value={`${Math.round(metrics.avgLlmTime)}ms`} />
          <MetricItem label="Avg Tool Time" value={`${Math.round(metrics.avgToolTime)}ms`} />
          <MetricItem label="Tokens/sec" value={metrics.tokensPerSecond.toFixed(1)} />
        </div>
      </MetricCard>

      {/* Error Analysis */}
      <MetricCard title="Error Analysis" icon={<AlertTriangle className="h-4 w-4" />}>
        <div className="space-y-3">
          <MetricItem label="Total Errors" value={metrics.errorCount} />
          <MetricItem label="Error Rate" value={`${(metrics.errorRate * 100).toFixed(1)}%`} />
          {Object.entries(metrics.errorsByType).length > 0 && (
            <div className="pt-2 border-t">
              <div className="text-xs font-medium mb-2">By Type:</div>
              {Object.entries(metrics.errorsByType).map(([type, count]) => (
                <div key={type} className="flex justify-between text-xs py-1">
                  <span className="text-muted-foreground">{type}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </MetricCard>

      {/* Tool Performance Breakdown */}
      <MetricCard title="Tool Breakdown" icon={<Zap className="h-4 w-4" />}>
        <div className="space-y-2">
          {Object.entries(metrics.toolPerformance).length === 0 ? (
            <p className="text-sm text-muted-foreground">No tool calls yet</p>
          ) : (
            Object.entries(metrics.toolPerformance).map(([tool, perf]) => (
              <div key={tool} className="border-l-2 border-primary pl-3 py-1">
                <div className="font-medium text-sm">{tool}</div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>Calls: {perf.count} | Avg: {Math.round(perf.avgDuration)}ms</div>
                  <div>Min: {Math.round(perf.minDuration)}ms | Max: {Math.round(perf.maxDuration)}ms</div>
                </div>
              </div>
            ))
          )}
        </div>
      </MetricCard>
    </div>
  );
}
