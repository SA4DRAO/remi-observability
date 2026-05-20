import type { OtlpPayload, OtlpAttribute, OtlpAttributeValue } from '../types/validation';

export interface NormalizedEvent {
  event_type: 'otel_span';
  data: Record<string, unknown>;
  _seq?: number;
  run_id?: string;
  parent_run_id?: string;
  timestamp?: string;
}

export interface NormalizedBatch {
  session_id: string;
  org_id?: string;
  agent_id?: string;
  agent_version?: string;
  conversation_id?: string;
  prompt_version?: string;
  final_output?: string;
  source: 'webhook' | 'sdk';
  events: NormalizedEvent[];
}

export interface TraceIdentity {
  sessionId?: string;
  orgId?: string;
  agentId?: string;
}

export type ProviderAliasType =
  | 'request_id'
  | 'response_id'
  | 'conversation_id'
  | 'run_id';

export interface ProviderAlias {
  provider: string;
  aliasType: ProviderAliasType;
  aliasValue: string;
}

export interface TraceResolutionCandidate {
  traceId: string;
  explicitIdentity: TraceIdentity;
  aliases: ProviderAlias[];
}

// ---------------------------------------------------------------------------
// Semantic convention key lists — ordered by preference (most specific first)
// Handles gen_ai (CNCF OTel stable), llm (traceloop/openinference), legacy.
// ---------------------------------------------------------------------------
const PROMPT_TOKEN_KEYS = [
  'gen_ai.usage.prompt_tokens',
  'gen_ai.usage.input_tokens',
  'llm.usage.prompt_tokens',
  'llm.token_count.prompt',
  'llm.usage.input_tokens',
] as const;

const COMPLETION_TOKEN_KEYS = [
  'gen_ai.usage.completion_tokens',
  'gen_ai.usage.output_tokens',
  'llm.usage.completion_tokens',
  'llm.token_count.completion',
  'llm.usage.output_tokens',
] as const;

const MODEL_KEYS = [
  'gen_ai.request.model',
  'llm.request.model',
  'llm.model_name',
  'gen_ai.model',
] as const;

const TOOL_NAME_KEYS = [
  'gen_ai.tool.name',
  'tool.name',
  'openinference.tool.name',
] as const;

// Prompt/completion content keys in priority order — first non-empty wins.
// Covers: RemiCallback (llm.*), CNCF gen_ai stable, OpenInference, OpenLLMetry/Traceloop.
const PROMPT_CONTENT_FALLBACK_KEYS = [
  'gen_ai.prompt',
  'gen_ai.input',
  'llm.input_messages',
  'input.value',
  'llm.prompts',
] as const;

const COMPLETION_CONTENT_FALLBACK_KEYS = [
  'gen_ai.completion',
  'gen_ai.output',
  'llm.output_messages',
  'output.value',
  'llm.completions',
] as const;

const PROVIDER_KEYS = [
  'gen_ai.system',
  'llm.system',
  'llm.provider',
  'openinference.provider',
  'provider',
] as const;

const PROVIDER_ALIAS_DEFINITIONS = [
  {
    aliasType: 'request_id' as const,
    keys: [
      'gen_ai.request.id',
      'llm.request.id',
      'openinference.request.id',
      'request.id',
      'openai.request_id',
      'anthropic.request_id',
      'openrouter.request_id',
    ] as const,
  },
  {
    aliasType: 'response_id' as const,
    keys: [
      'gen_ai.response.id',
      'llm.response.id',
      'openinference.response.id',
      'response.id',
      'openai.response_id',
      'anthropic.message.id',
      'openrouter.response_id',
    ] as const,
  },
  {
    aliasType: 'conversation_id' as const,
    keys: [
      'gen_ai.conversation.id',
      'llm.conversation.id',
      'conversation.id',
      'thread.id',
    ] as const,
  },
  {
    aliasType: 'run_id' as const,
    keys: ['gen_ai.run.id', 'llm.run.id', 'openinference.run.id', 'run.id'] as const,
  },
] as const;

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a scalar (or array of scalars) from an OTLP attribute value union.
 * intValue is coerced from string to number (int64 JSON representation safety).
 * arrayValue is expanded to a list of extracted scalars.
 */
export function extractAttributeValue(
  v: OtlpAttributeValue
): string | number | boolean | unknown[] | null {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) {
    return typeof v.intValue === 'number' ? v.intValue : Number(v.intValue);
  }
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  // Handle OTLP array values (e.g. gen_ai.response.finish_reasons)
  const anyV = v as Record<string, unknown>;
  if (anyV['arrayValue'] !== undefined) {
    const arr = anyV['arrayValue'] as { values?: Array<Record<string, unknown>> };
    return (arr.values ?? []).map((item) =>
      extractAttributeValue(item as OtlpAttributeValue)
    );
  }
  return null;
}

/**
 * Flattens an OTLP attribute array into a plain key→value record.
 */
export function flattenAttributes(attrs: OtlpAttribute[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const attr of attrs) {
    result[attr.key] = extractAttributeValue(attr.value);
  }
  return result;
}

function getStringAttr(
  attrs: Record<string, unknown>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const v = attrs[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function getNumberAttr(
  attrs: Record<string, unknown>,
  ...keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const v = attrs[key];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.length > 0 && !isNaN(Number(v))) return Number(v);
  }
  return undefined;
}

function getStringAttribute(
  attributes: Record<string, unknown>,
  key: string
): string | undefined {
  const v = attributes[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function createIdentity(
  sessionId: string | undefined,
  orgId: string | undefined,
  agentId: string | undefined
): TraceIdentity {
  const identity: TraceIdentity = {};
  if (sessionId !== undefined) identity.sessionId = sessionId;
  if (orgId !== undefined) identity.orgId = orgId;
  if (agentId !== undefined) identity.agentId = agentId;
  return identity;
}

interface ResourceIdentity extends TraceIdentity {
  agentVersion?: string;
}

function getResourceIdentity(attrs: Record<string, unknown>): ResourceIdentity {
  // OTEL-native: service.namespace = org, service.name = agent, service.version = version.
  // Fall back to the legacy remi-specific resource keys for any existing data.
  const identity = createIdentity(
    getStringAttribute(attrs, 'session.id'),
    getStringAttribute(attrs, 'service.namespace') ?? getStringAttribute(attrs, 'org.id'),
    getStringAttribute(attrs, 'service.name') ?? getStringAttribute(attrs, 'agent.id')
  ) as ResourceIdentity;
  const version = getStringAttribute(attrs, 'service.version');
  if (version !== undefined) identity.agentVersion = version;
  return identity;
}

function getSpanIdentity(attrs: Record<string, unknown>): TraceIdentity {
  return createIdentity(
    getStringAttribute(attrs, 'remi.session_id'),
    getStringAttribute(attrs, 'remi.org_id'),
    getStringAttribute(attrs, 'remi.agent_id')
  );
}

function hasIdentity(identity: TraceIdentity): boolean {
  return (
    identity.sessionId !== undefined ||
    identity.orgId !== undefined ||
    identity.agentId !== undefined
  );
}

function mergeIdentity(
  current: TraceIdentity | undefined,
  next: TraceIdentity
): TraceIdentity {
  if (current === undefined) return { ...next };
  return createIdentity(
    current.sessionId ?? next.sessionId,
    current.orgId ?? next.orgId,
    current.agentId ?? next.agentId
  );
}

function detectProvider(attrs: Record<string, unknown>): string | undefined {
  return getStringAttr(attrs, ...PROVIDER_KEYS);
}

function createAliasKey(alias: ProviderAlias): string {
  return `${alias.provider}\u0000${alias.aliasType}\u0000${alias.aliasValue}`;
}

function extractProviderAliases(
  attrs: Record<string, unknown>,
  provider: string | undefined
): ProviderAlias[] {
  const resolvedProvider = provider ?? 'unknown';
  const aliases: ProviderAlias[] = [];

  for (const definition of PROVIDER_ALIAS_DEFINITIONS) {
    const aliasValue = getStringAttr(attrs, ...definition.keys);
    if (aliasValue === undefined) continue;
    aliases.push({
      provider: resolvedProvider,
      aliasType: definition.aliasType,
      aliasValue,
    });
  }

  return aliases;
}

export function collectTraceResolutionCandidates(
  payload: OtlpPayload
): TraceResolutionCandidate[] {
  const candidateMap = new Map<
    string,
    {
      explicitIdentity: TraceIdentity;
      aliasMap: Map<string, ProviderAlias>;
    }
  >();

  for (const resourceSpan of payload.resourceSpans ?? []) {
    const resourceAttrs = flattenAttributes(resourceSpan.resource?.attributes ?? []);
    const resourceIdentity = getResourceIdentity(resourceAttrs);
    const resourceProvider = detectProvider(resourceAttrs);
    const resourceAliases = extractProviderAliases(resourceAttrs, resourceProvider);

    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        const spanAttrs = flattenAttributes(span.attributes ?? []);
        const spanIdentity = getSpanIdentity(spanAttrs);
        const explicitIdentity = mergeIdentity(spanIdentity, resourceIdentity);
        const provider = detectProvider(spanAttrs) ?? resourceProvider;
        const spanAliases = extractProviderAliases(spanAttrs, provider);

        let candidate = candidateMap.get(span.traceId);
        if (candidate === undefined) {
          candidate = {
            explicitIdentity,
            aliasMap: new Map<string, ProviderAlias>(),
          };
          candidateMap.set(span.traceId, candidate);
        } else {
          candidate.explicitIdentity = mergeIdentity(candidate.explicitIdentity, explicitIdentity);
        }

        for (const alias of [...resourceAliases, ...spanAliases]) {
          const aliasKey = createAliasKey(alias);
          if (!candidate.aliasMap.has(aliasKey)) {
            candidate.aliasMap.set(aliasKey, alias);
          }
        }
      }
    }
  }

  return Array.from(candidateMap.entries(), ([traceId, candidate]) => ({
    traceId,
    explicitIdentity: candidate.explicitIdentity,
    aliases: Array.from(candidate.aliasMap.values()),
  }));
}

// ---------------------------------------------------------------------------
// Span classification
// ---------------------------------------------------------------------------

/**
 * Classifies a span into a semantic category the worker can aggregate on.
 *
 * Priority order:
 * 1. Explicit framework kind marker (traceloop.span.kind / openinference.span.kind)
 * 2. Token presence (any known input/output token attribute)
 * 3. Model name / gen_ai.system presence
 * 4. Tool name attribute
 * 5. Remi root session span marker
 * 6. Span name keyword fallback
 */
function classifySpan(attrs: Record<string, unknown>, spanName: string): string {
  const explicitKind =
    getStringAttr(attrs, 'traceloop.span.kind') ??
    getStringAttr(attrs, 'openinference.span.kind');

  if (explicitKind !== undefined) {
    const k = explicitKind.toLowerCase();
    if (k === 'llm' || k === 'embedding') return 'llm';
    if (k === 'tool') return 'tool';
    if (k === 'chain' || k === 'agent' || k === 'workflow') return 'chain';
  }

  // Token presence is a reliable LLM indicator across all instrumentation packages
  if (
    getNumberAttr(attrs, ...PROMPT_TOKEN_KEYS) !== undefined ||
    getNumberAttr(attrs, ...COMPLETION_TOKEN_KEYS) !== undefined ||
    getStringAttr(attrs, ...MODEL_KEYS) !== undefined ||
    getStringAttr(attrs, 'gen_ai.system') !== undefined
  ) {
    return 'llm';
  }

  if (getStringAttr(attrs, ...TOOL_NAME_KEYS) !== undefined) return 'tool';

  // LangGraph span patterns from opentelemetry-instrumentation-langchain:
  // - execute_tool {name} → actual tool invocation (lookup_customer, etc.)
  // - execute_task {name} → workflow node (agent, should_continue, Prompt, etc.)
  const lower = spanName.toLowerCase();
  if (lower.startsWith('execute_tool')) return 'tool';
  if (lower.startsWith('execute_task')) return 'chain';

  // Root session span set by remi otel_setup
  if (getStringAttribute(attrs, 'remi.session_id') !== undefined) return 'root';

  if (
    lower.includes('llm') ||
    lower.includes('chat') ||
    lower.includes('completion') ||
    lower.includes('embed')
  ) {
    return 'llm';
  }
  if (lower.includes('tool') || lower.includes('retriev')) return 'tool';
  if (
    lower.includes('chain') ||
    lower.includes('agent') ||
    lower.includes('graph') ||
    lower.includes('run')
  ) {
    return 'chain';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Semantic field extractors
// ---------------------------------------------------------------------------

/**
 * Normalizes prompt/completion content into canonical llm.prompt / llm.completion keys.
 * Mutates attrs in place so the stored span_attributes_v2 rows always use consistent keys
 * regardless of the instrumentation library (RemiCallback, gen_ai, OpenInference, Traceloop).
 */
function normalizePromptCompletion(attrs: Record<string, unknown>): void {
  if (!attrs['llm.prompt']) {
    for (const key of PROMPT_CONTENT_FALLBACK_KEYS) {
      const val = attrs[key];
      if (val !== undefined && val !== null && val !== '') {
        const str = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
        if (str.length > 0) {
          attrs['llm.prompt'] = str.slice(0, 32768);
          break;
        }
      }
    }
  }
  if (!attrs['llm.completion']) {
    for (const key of COMPLETION_CONTENT_FALLBACK_KEYS) {
      const val = attrs[key];
      if (val !== undefined && val !== null && val !== '') {
        const str = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
        if (str.length > 0) {
          attrs['llm.completion'] = str.slice(0, 32768);
          break;
        }
      }
    }
  }
}

function extractFinishReasons(attrs: Record<string, unknown>): string[] {
  const raw = attrs['gen_ai.response.finish_reasons'];
  if (Array.isArray(raw)) {
    return raw.filter((r): r is string => typeof r === 'string');
  }
  if (typeof raw === 'string' && raw.length > 0) return [raw];
  return [];
}

function extractUsage(attrs: Record<string, unknown>): {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
} {
  const prompt = getNumberAttr(attrs, ...PROMPT_TOKEN_KEYS) ?? 0;
  const completion = getNumberAttr(attrs, ...COMPLETION_TOKEN_KEYS) ?? 0;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

// ---------------------------------------------------------------------------
// Nano-second timestamp helpers
// ---------------------------------------------------------------------------

function nanosToIso(nanoStr: string): string {
  // BigInt arithmetic avoids float precision loss on int64 nanosecond values
  const ms = Number(BigInt(nanoStr) / 1_000_000n);
  return new Date(ms).toISOString();
}

function nanosToMs(startNs: string, endNs: string): number {
  return Number(BigInt(endNs) - BigInt(startNs)) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Main normalizer
// ---------------------------------------------------------------------------

/**
 * Normalizes an OTLP JSON payload into canonical Remi ingest batches.
 *
 * All spans are emitted with event_type "otel_span" and a span_category
 * field so the worker can aggregate meaningful metrics without any legacy
 * LangChain callback event name knowledge.
 *
 * Identity resolution (session_id / org_id / agent_id), highest → lowest:
 * 1. headerIdentity — set by the collector via x-remi-org-id / x-remi-agent-id
 *    (OTEL-native way for external sources like OpenRouter that don't control
 *    the Python process and can't set Resource attributes themselves)
 * 2. span-level remi.session_id / remi.org_id / remi.agent_id attributes
 * 3. Resource-level service.namespace (org) / service.name (agent) / session.id
 * Spans without an explicit session identity are dropped.
 */
export function normalizeOtlpPayload(
  payload: OtlpPayload,
  source: 'webhook' | 'sdk',
  headerIdentity: { orgId?: string; agentId?: string } = {},
  resolvedTraceIdentities: ReadonlyMap<string, TraceIdentity> = new Map<string, TraceIdentity>()
): NormalizedBatch[] {
  const batchMap = new Map<string, NormalizedBatch>();
  const traceIdentityMap = new Map<string, TraceIdentity>();

  // ── Pass 1: collect span-level Remi identity per trace ─────────────────
  for (const resourceSpan of payload.resourceSpans ?? []) {
    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        const spanIdentity = getSpanIdentity(flattenAttributes(span.attributes ?? []));
        if (!hasIdentity(spanIdentity)) continue;
        traceIdentityMap.set(
          span.traceId,
          mergeIdentity(traceIdentityMap.get(span.traceId), spanIdentity)
        );
      }
    }
  }

  // ── Pass 2: emit one otel_span event per span ────────────────────────────
  for (const resourceSpan of payload.resourceSpans ?? []) {
    const resourceAttrs = flattenAttributes(resourceSpan.resource?.attributes ?? []);
    const resourceIdentity = getResourceIdentity(resourceAttrs);

    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      const scopeName = scopeSpan.scope?.name;
      const scopeVersion = scopeSpan.scope?.version;

      for (const span of scopeSpan.spans ?? []) {
        const traceIdentity = traceIdentityMap.get(span.traceId);
        const resolvedTraceIdentity = resolvedTraceIdentities.get(span.traceId);
        const sessionId =
          traceIdentity?.sessionId ?? resourceIdentity.sessionId ?? resolvedTraceIdentity?.sessionId;
        if (sessionId === undefined) continue;
        // Resource identity (service.namespace/service.name) wins — agents that
        // set their own identity take precedence. Header is fallback for external
        // sources (OpenRouter) that have no resource attributes.
        const orgId =
          resourceIdentity.orgId ??
          headerIdentity.orgId ??
          traceIdentity?.orgId ??
          resolvedTraceIdentity?.orgId;
        const agentId =
          resourceIdentity.agentId ??
          headerIdentity.agentId ??
          traceIdentity?.agentId ??
          resolvedTraceIdentity?.agentId;

        const spanAttrs = flattenAttributes(span.attributes ?? []);
        normalizePromptCompletion(spanAttrs);
        const spanCategory = classifySpan(spanAttrs, span.name);

        let durationMs: number | undefined;
        if (span.startTimeUnixNano !== undefined && span.endTimeUnixNano !== undefined) {
          durationMs = nanosToMs(span.startTimeUnixNano, span.endTimeUnixNano);
        }

        let timestamp: string | undefined;
        if (span.startTimeUnixNano !== undefined) {
          timestamp = nanosToIso(span.startTimeUnixNano);
        }

        const data: Record<string, unknown> = {
          trace_id: span.traceId,
          span_id: span.spanId,
          span_name: span.name,
          span_category: spanCategory,
          attributes: spanAttrs,
          source,
        };

        if (span.parentSpanId !== undefined) data['parent_span_id'] = span.parentSpanId;
        if (span.kind !== undefined) data['span_kind'] = span.kind;
        // OTLP status codes: 0=unset, 1=ok, 2=error
        if (span.status?.code !== undefined) data['status_code'] = span.status.code;
        if (span.status?.message !== undefined) data['status_message'] = span.status.message;
        if (span.startTimeUnixNano !== undefined) data['start_time_ns'] = span.startTimeUnixNano;
        if (span.endTimeUnixNano !== undefined) data['end_time_ns'] = span.endTimeUnixNano;
        if (durationMs !== undefined) data['duration_ms'] = durationMs;
        if (scopeName !== undefined) data['scope_name'] = scopeName;
        if (scopeVersion !== undefined) data['scope_version'] = scopeVersion;

        // Pre-extract LLM-specific semantic fields — worker reads these directly
        if (spanCategory === 'llm') {
          data['usage'] = extractUsage(spanAttrs);
          const model = getStringAttr(spanAttrs, ...MODEL_KEYS);
          if (model !== undefined) data['model'] = model;
          const finishReasons = extractFinishReasons(spanAttrs);
          if (finishReasons.length > 0) data['finish_reasons'] = finishReasons;
        }

        // Pre-extract tool name for tool spans
        if (spanCategory === 'tool') {
          let toolName =
            getStringAttr(spanAttrs, ...TOOL_NAME_KEYS) ??
            getStringAttr(spanAttrs, 'gen_ai.task.name');

          // Parse tool name from LangGraph execute_tool span names
          if (toolName === undefined && span.name.toLowerCase().startsWith('execute_tool ')) {
            toolName = span.name.substring('execute_tool '.length).trim();
          }

          data['tool_name'] = toolName ?? span.name;
        }

        const event: NormalizedEvent = {
          event_type: 'otel_span',
          data,
          run_id: span.spanId,
          ...(span.parentSpanId !== undefined ? { parent_run_id: span.parentSpanId } : {}),
          ...(timestamp !== undefined ? { timestamp } : {}),
        };

        const agentVersion = resourceIdentity.agentVersion;
        // Session-level metadata extracted from span attributes
        const conversationId = getStringAttribute(spanAttrs, 'gen_ai.conversation.id');
        const promptVersion = getStringAttribute(spanAttrs, 'remi.prompt_version');
        const finalOutput = getStringAttribute(spanAttrs, 'remi.final_output');

        let batch = batchMap.get(sessionId);
        if (batch === undefined) {
          batch = { session_id: sessionId, source, events: [] };
          if (orgId !== undefined) batch.org_id = orgId;
          if (agentId !== undefined) batch.agent_id = agentId;
          if (agentVersion !== undefined) batch.agent_version = agentVersion;
          if (conversationId !== undefined) batch.conversation_id = conversationId;
          if (promptVersion !== undefined) batch.prompt_version = promptVersion;
          if (finalOutput !== undefined) batch.final_output = finalOutput;
          batchMap.set(sessionId, batch);
        } else {
          if (agentVersion !== undefined && batch.agent_version === undefined)
            batch.agent_version = agentVersion;
          if (conversationId !== undefined && batch.conversation_id === undefined)
            batch.conversation_id = conversationId;
          if (promptVersion !== undefined && batch.prompt_version === undefined)
            batch.prompt_version = promptVersion;
          // final_output: last writer wins (the actual terminal span fires last)
          if (finalOutput !== undefined) batch.final_output = finalOutput;
        }
        batch.events.push(event);
      }
    }
  }

  return Array.from(batchMap.values());
}
