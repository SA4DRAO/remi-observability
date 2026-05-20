import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Wrench,
  FileText,
  CheckCircle2,
  Bot,
  Link2,
  Search,
  Files,
  AlertCircle,
  BarChart3,
  Timer,
  DollarSign,
  Settings2,
  TrendingUp,
  Code2,
  ArrowRight,
} from "lucide-react";
import type { Event, EventData } from "../../types/events";
import {
  Section,
  CodeBlock,
  MetadataRow,
  MetricBox,
  TokenMetric,
  renderIfExists,
  formatBytes,
} from "./EventRenderers";

interface EventDetailContentProps {
  event: Event;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatFixed(value: unknown, digits: number): string | null {
  const n = asFiniteNumber(value);
  return n === null ? null : n.toFixed(digits);
}

// ─── Per-event primary content ───────────────────────────────────────────────

function LlmEndPrimary({ data }: { data: EventData }) {
  return (
    <>
      {typeof data.content === "string" && (
        <Section title={<><MessageSquare className="h-3.5 w-3.5" /> Response</>}>
          <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{data.content}</p>
          </div>
        </Section>
      )}
      {Array.isArray(data.tool_calls) && data.tool_calls.length > 0 && (
        <Section title={<><Wrench className="h-3.5 w-3.5" /> Tool Calls Requested</>}>
          <div className="space-y-2">
            {(data.tool_calls as any[]).map((call, idx) => (
              <div key={idx} className="border rounded-lg overflow-hidden">
                <div className="bg-orange-50 dark:bg-orange-950 border-b border-orange-200 dark:border-orange-800 px-3 py-2 font-mono text-sm font-semibold text-orange-700 dark:text-orange-300">
                  {call.function?.name ?? "unknown"}
                </div>
                {call.function?.arguments && (
                  <pre className="text-xs p-3 bg-muted overflow-x-auto whitespace-pre-wrap">
                    {(() => { try { return JSON.stringify(JSON.parse(call.function.arguments), null, 2); } catch { return call.function.arguments; } })()}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function LlmStartPrimary({ data }: { data: EventData }) {
  const messages = (data as any).messages ?? data.inputs;
  if (!messages) return null;
  return (
    <Section title={<><FileText className="h-3.5 w-3.5" /> Prompt / Messages</>}>
      <CodeBlock content={messages} theme="blue" />
    </Section>
  );
}

function ToolStartPrimary({ data }: { data: EventData }) {
  return (
    <Section title={<><ArrowRight className="h-3.5 w-3.5" /> Input{typeof data.tool === "string" ? ` → ${data.tool}` : ""}</>}>
      <div className="space-y-2">
        <CodeBlock content={data.input ?? "(no input)"} theme="orange" />
        {typeof data.input_size_bytes === "number" && (
          <div className="text-xs text-muted-foreground text-right">{formatBytes(data.input_size_bytes)}</div>
        )}
      </div>
    </Section>
  );
}

function ToolEndPrimary({ data }: { data: EventData }) {
  return (
    <Section title={<><CheckCircle2 className="h-3.5 w-3.5" /> Output</>}>
      <div className="space-y-2">
        <CodeBlock content={data.output ?? "(no output)"} theme="green" />
        {typeof data.output_size_bytes === "number" && (
          <div className="text-xs text-muted-foreground text-right">{formatBytes(data.output_size_bytes)}</div>
        )}
      </div>
    </Section>
  );
}

function AgentActionPrimary({ data }: { data: EventData }) {
  return (
    <Section title={<><Bot className="h-3.5 w-3.5" /> Action</>}>
      <div className="space-y-3">
        {typeof data.tool === "string" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Tool:</span>
            <code className="text-sm font-semibold bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded">
              {data.tool}
            </code>
          </div>
        )}
        {renderIfExists(data.tool_input, (input) => (
          <CodeBlock content={input} theme="purple" label="Input" />
        ))}
        {typeof data.log === "string" && data.log.trim() && (
          <CodeBlock content={data.log} theme="gray" label="Thought / Log" />
        )}
      </div>
    </Section>
  );
}

function AgentFinishPrimary({ data }: { data: EventData }) {
  return renderIfExists(data.return_values, (values) => (
    <Section title={<><CheckCircle2 className="h-3.5 w-3.5" /> Result</>}>
      <CodeBlock content={values} theme="green" label="Return Values" />
    </Section>
  ));
}

function ChainStartPrimary({ data }: { data: EventData }) {
  return (
    <Section title={<><Link2 className="h-3.5 w-3.5" /> Chain Input</>}>
      <div className="space-y-3">
        {typeof data.chain === "string" && (
          <div className="text-sm text-muted-foreground">
            Chain: <span className="font-medium text-foreground">{data.chain}</span>
          </div>
        )}
        {renderIfExists(data.inputs, (inputs) => (
          <CodeBlock content={inputs} theme="green" label="Inputs" />
        ))}
      </div>
    </Section>
  );
}

function ChainEndPrimary({ data }: { data: EventData }) {
  return renderIfExists(data.outputs, (outputs) => (
    <Section title={<><CheckCircle2 className="h-3.5 w-3.5" /> Chain Output</>}>
      <CodeBlock content={outputs} theme="green" label="Outputs" />
    </Section>
  ));
}

function RetrieverStartPrimary({ data }: { data: EventData }) {
  return (
    <Section title={<><Search className="h-3.5 w-3.5" /> Query</>}>
      <div className="space-y-3">
        {typeof data.retriever === "string" && (
          <div className="text-sm text-muted-foreground">
            Retriever: <span className="font-medium text-foreground">{data.retriever}</span>
          </div>
        )}
        {renderIfExists(data.query, (q) => (
          <div className="bg-cyan-50 dark:bg-cyan-950 border border-cyan-200 dark:border-cyan-800 rounded-lg p-3">
            <p className="text-sm font-medium text-cyan-800 dark:text-cyan-200">{String(q)}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function RetrieverEndPrimary({ data }: { data: EventData }) {
  return (
    <Section title={<><Files className="h-3.5 w-3.5" /> Retrieved Documents</>}>
      <div className="space-y-2">
        {typeof data.docs_count === "number" && (
          <div className="text-sm text-muted-foreground">
            {data.docs_count} document{data.docs_count !== 1 ? "s" : ""} returned
          </div>
        )}
        {renderIfExists(data.documents, (docs) => (
          <CodeBlock content={docs} theme="cyan" />
        ))}
      </div>
    </Section>
  );
}

function ErrorPrimary({ data }: { data: EventData }) {
  if (!data.error) return null;
  return (
    <Section title={<><AlertCircle className="h-3.5 w-3.5 text-red-500" /> Error</>}>
      <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-2">
        {typeof data.error_type === "string" && (
          <div className="text-xs font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide">
            {data.error_type}
          </div>
        )}
        <p className="text-sm text-red-800 dark:text-red-200 font-mono whitespace-pre-wrap">{String(data.error)}</p>
        {typeof data.total_errors_in_session === "number" && (
          <div className="text-xs text-red-500 dark:text-red-400 pt-1 border-t border-red-200 dark:border-red-800">
            {data.total_errors_in_session} error{data.total_errors_in_session !== 1 ? "s" : ""} total in session
          </div>
        )}
      </div>
    </Section>
  );
}

function TextPrimary({ data }: { data: EventData }) {
  if (!data.text) return null;
  return (
    <Section title={<><FileText className="h-3.5 w-3.5" /> Text Output</>}>
      <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-3">
        <p className="text-sm whitespace-pre-wrap">{String(data.text)}</p>
      </div>
    </Section>
  );
}

// ─── Collapsible raw data ────────────────────────────────────────────────────

function RawDataSection({ data }: { data: EventData }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted text-sm font-medium hover:bg-muted/80 transition-colors text-left"
      >
        <span className="inline-flex items-center gap-1.5"><Code2 className="h-3.5 w-3.5" /> Raw Event Data</span>
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      </button>
      {open && (
        <pre className="text-xs p-4 overflow-x-auto bg-gray-50 dark:bg-gray-950 text-gray-700 dark:text-gray-300 max-h-80 overflow-y-auto whitespace-pre-wrap">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function EventDetailContent({ event }: EventDetailContentProps) {
  const { event_type, data } = event;

  const toolMetrics = (data.tool_metrics as any) ?? null;
  const formattedCost = formatFixed(data.estimated_cost_usd, 6);
  const formattedAvgTool = formatFixed(toolMetrics?.avg_duration_ms, 2);
  const formattedMinTool = formatFixed(toolMetrics?.min_duration_ms, 2);
  const formattedMaxTool = formatFixed(toolMetrics?.max_duration_ms, 2);
  const totalPromptLength = asFiniteNumber(data.total_prompt_length);
  const avgPromptLength = formatFixed(data.avg_prompt_length, 0);
  const totalErrors = asFiniteNumber(data.total_errors_in_session);
  const formattedErrorRate = (() => {
    const n = asFiniteNumber(data.error_rate);
    return n === null ? null : `${(n * 100).toFixed(1)}%`;
  })();

  return (
    <div className="space-y-6">

      {/* ── Event-specific primary content ── */}
      {event_type === "llm_end"         && <LlmEndPrimary data={data} />}
      {event_type === "llm_start"       && <LlmStartPrimary data={data} />}
      {event_type === "tool_start"      && <ToolStartPrimary data={data} />}
      {event_type === "tool_end"        && <ToolEndPrimary data={data} />}
      {event_type === "agent_action"    && <AgentActionPrimary data={data} />}
      {event_type === "agent_finish"    && <AgentFinishPrimary data={data} />}
      {event_type === "chain_start"     && <ChainStartPrimary data={data} />}
      {event_type === "chain_end"       && <ChainEndPrimary data={data} />}
      {event_type === "retriever_start" && <RetrieverStartPrimary data={data} />}
      {event_type === "retriever_end"   && <RetrieverEndPrimary data={data} />}
      {event_type === "text"            && <TextPrimary data={data} />}
      {event_type.includes("error")     && <ErrorPrimary data={data} />}

      {/* ── Token Usage ── */}
      {data.usage && typeof data.usage === "object" && (
        <Section title={<><BarChart3 className="h-3.5 w-3.5" /> Token Usage</>}>
          <div className="grid grid-cols-3 gap-2">
            {renderIfExists((data.usage as any).prompt_tokens, (t) => (
              <TokenMetric label="Prompt" value={t} />
            ))}
            {renderIfExists((data.usage as any).completion_tokens, (t) => (
              <TokenMetric label="Completion" value={t} />
            ))}
            {renderIfExists((data.usage as any).total_tokens, (t) => (
              <TokenMetric label="Total" value={t} />
            ))}
          </div>
        </Section>
      )}

      {/* ── Performance ── */}
      {typeof data.duration_ms === "number" && (
        <Section title={<><Timer className="h-3.5 w-3.5" /> Performance</>}>
          <div className="grid grid-cols-2 gap-2">
            <MetricBox label="Duration" value={`${data.duration_ms}ms`} color="blue" />
            {renderIfExists(data.tokens_per_second, (tps) => (
              <MetricBox label="Tokens / sec" value={String(tps)} color="green" />
            ))}
          </div>
          {renderIfExists(data.agent_loop_iteration, (iter) => (
            <div className="mt-2">
              <MetricBox label="Agent Loop Iteration" value={`#${iter}`} color="purple" />
            </div>
          ))}
        </Section>
      )}

      {/* ── Cost ── */}
      {formattedCost && (
        <Section title={<><DollarSign className="h-3.5 w-3.5" /> Cost Estimate</>}>
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <span className="text-sm">Estimated: </span>
            <strong className="text-lg">${formattedCost}</strong>
            <div className="text-xs text-muted-foreground mt-1">Based on current model pricing</div>
          </div>
        </Section>
      )}

      {/* ── Tool Metrics (chain_end / session summaries) ── */}
      {toolMetrics && (
        <Section title={<><Settings2 className="h-3.5 w-3.5" /> Tool Metrics</>}>
          <div className="bg-muted rounded-lg p-3 space-y-2 text-sm">
            {renderIfExists(toolMetrics.count, (c) => <MetadataRow label="Count" value={c} />)}
            {formattedAvgTool && <MetadataRow label="Avg Duration" value={`${formattedAvgTool}ms`} />}
            {formattedMinTool && <MetadataRow label="Min Duration" value={`${formattedMinTool}ms`} />}
            {formattedMaxTool && <MetadataRow label="Max Duration" value={`${formattedMaxTool}ms`} />}
            {renderIfExists(toolMetrics.error_count, (e) => (
              <MetadataRow label="Errors" value={e} valueClassName="text-red-600 dark:text-red-400" />
            ))}
          </div>
        </Section>
      )}

      {/* ── Session Analytics ── */}
      {(totalPromptLength !== null || (totalErrors !== null && totalErrors > 0)) && (
        <Section title={<><TrendingUp className="h-3.5 w-3.5" /> Session Analytics</>}>
          <div className="space-y-2">
            {totalPromptLength !== null && (
              <div className="bg-cyan-50 dark:bg-cyan-950 border border-cyan-200 dark:border-cyan-800 rounded-lg p-3">
                <div className="text-xs text-cyan-600 dark:text-cyan-400">Prompt Analysis</div>
                <div className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">
                  {totalPromptLength.toLocaleString()} chars total
                  {avgPromptLength && <span className="font-normal text-xs ml-2">· avg {avgPromptLength}</span>}
                </div>
              </div>
            )}
            {totalErrors !== null && totalErrors > 0 && (
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <div className="text-xs text-red-500 dark:text-red-400">Errors in Session</div>
                <div className="text-lg font-semibold text-red-700 dark:text-red-300">
                  {totalErrors} error{totalErrors !== 1 ? "s" : ""}
                  {formattedErrorRate && <span className="font-normal text-sm ml-2">({formattedErrorRate})</span>}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── Metadata ── */}
      {(data.model || data.service_tier || data.finish_reason || data.response_id || data.error_type) && (
        <Section title={<><Settings2 className="h-3.5 w-3.5" /> Metadata</>}>
          <div className="bg-muted rounded-lg p-3 space-y-2 text-sm">
            {renderIfExists(data.model, (m) => <MetadataRow label="Model" value={String(m)} />)}
            {renderIfExists(data.service_tier, (t) => <MetadataRow label="Service Tier" value={String(t)} />)}
            {renderIfExists(data.finish_reason, (r) => <MetadataRow label="Finish Reason" value={String(r)} />)}
            {renderIfExists(data.response_id, (id) => <MetadataRow label="Response ID" value={String(id)} />)}
            {renderIfExists(data.error_type, (t) => (
              <MetadataRow label="Error Type" value={String(t)} valueClassName="text-red-600 dark:text-red-400" />
            ))}
            {renderIfExists(data.input_size_bytes, (b) => <MetadataRow label="Input Size" value={formatBytes(b as number)} />)}
            {renderIfExists(data.output_size_bytes, (b) => <MetadataRow label="Output Size" value={formatBytes(b as number)} />)}
          </div>
        </Section>
      )}

      {/* ── Raw Data (collapsed) ── */}
      <RawDataSection data={data} />
    </div>
  );
}

