type HeaderOrgId = string | string[] | undefined;

export interface ResolveOrgIdOptions {
  bodyOrgId?: unknown;
  headerOrgId?: HeaderOrgId;
  existingOrgId?: string | null;
  sessionId?: string;
}

export class OrgIdResolutionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OrgIdResolutionError';
    this.status = status;
  }
}

export function normalizeOrgId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function resolveOrgId({
  bodyOrgId,
  headerOrgId,
  existingOrgId,
  sessionId,
}: ResolveOrgIdOptions): string | null {
  const normalizedBodyOrgId = normalizeOrgId(bodyOrgId);
  const normalizedHeaderOrgId = normalizeOrgId(
    Array.isArray(headerOrgId) ? headerOrgId[0] : headerOrgId
  );
  const normalizedExistingOrgId = normalizeOrgId(existingOrgId);

  if (
    normalizedBodyOrgId !== null &&
    normalizedHeaderOrgId !== null &&
    normalizedBodyOrgId !== normalizedHeaderOrgId
  ) {
    throw new OrgIdResolutionError(
      'org_id in request body does not match X-Org-Id header',
      400
    );
  }

  const resolvedRequestOrgId = normalizedBodyOrgId ?? normalizedHeaderOrgId;

  if (
    resolvedRequestOrgId !== null &&
    normalizedExistingOrgId !== null &&
    resolvedRequestOrgId !== normalizedExistingOrgId
  ) {
    const sessionContext = sessionId ? ` for session ${sessionId}` : '';
    throw new OrgIdResolutionError(
      `Conflicting org_id${sessionContext}`,
      409
    );
  }

  return normalizedExistingOrgId ?? resolvedRequestOrgId;
}