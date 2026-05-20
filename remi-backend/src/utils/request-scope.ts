type ScopeValue = string | string[] | undefined;

export interface RequestScope {
  orgId: string | null;
  agentId: string | null;
}

export interface ResolveRequestScopeOptions {
  queryOrgId?: unknown;
  headerOrgId?: ScopeValue;
  queryAgentId?: unknown;
  headerAgentId?: ScopeValue;
}

export class RequestScopeResolutionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RequestScopeResolutionError';
    this.status = status;
  }
}

function normalizeScopeValue(
  fieldName: string,
  value: unknown,
  source: 'query parameter' | 'header'
): string | null {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return null;
    }
    return normalizeScopeValue(fieldName, value[0], source);
  }

  if (typeof value !== 'string') {
    throw new RequestScopeResolutionError(`${fieldName} ${source} must be a string`, 400);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveSingleScopeValue(
  fieldName: string,
  headerName: string,
  queryValue: unknown,
  headerValue: ScopeValue
): string | null {
  const normalizedQueryValue = normalizeScopeValue(fieldName, queryValue, 'query parameter');
  const normalizedHeaderValue = normalizeScopeValue(fieldName, headerValue, 'header');

  if (
    normalizedQueryValue !== null &&
    normalizedHeaderValue !== null &&
    normalizedQueryValue !== normalizedHeaderValue
  ) {
    throw new RequestScopeResolutionError(
      `${fieldName} query parameter does not match ${headerName} header`,
      400
    );
  }

  return normalizedQueryValue ?? normalizedHeaderValue;
}

export function resolveRequestScope({
  queryOrgId,
  headerOrgId,
  queryAgentId,
  headerAgentId,
}: ResolveRequestScopeOptions): RequestScope {
  return {
    orgId: resolveSingleScopeValue('org_id', 'X-Org-Id', queryOrgId, headerOrgId),
    agentId: resolveSingleScopeValue('agent_id', 'X-Agent-Id', queryAgentId, headerAgentId),
  };
}
