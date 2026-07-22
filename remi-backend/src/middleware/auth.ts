import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DatabaseService, ApiKeyRecord } from '../services/database.service';

export interface KeyContext {
  keyId: string;
  orgId: string;
  scopes: string[];
}

// In-memory cache with 5-minute TTL. Null value = known-bad key (also cached).
const KEY_CACHE_TTL_MS = 5 * 60 * 1000;
const keyCache = new Map<string, { record: ApiKeyRecord | null; expiry: number }>();

function isExpired(record: ApiKeyRecord): boolean {
  if (record.revoked_at) return true;
  if (record.expires_at && new Date(record.expires_at) < new Date()) return true;
  return false;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function createRequireApiKey(
  getDatabase: () => DatabaseService | null
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Missing Authorization header' });
      return;
    }

    const rawKey = authHeader.slice(7).trim();
    if (!rawKey) {
      res.status(401).json({ success: false, error: 'Empty API key' });
      return;
    }

    const db = getDatabase();
    if (!db) {
      res.status(503).json({ success: false, error: 'Auth service not available' });
      return;
    }

    // Check in-memory cache first (uses timing-safe comparison on the raw key)
    const now = Date.now();
    for (const [cachedKey, entry] of keyCache.entries()) {
      if (entry.expiry < now) { keyCache.delete(cachedKey); continue; }
      if (timingSafeStringEqual(cachedKey, rawKey)) {
        if (!entry.record) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        attachContext(res, entry.record);
        next();
        return;
      }
    }

    // Cache miss — query PostgreSQL
    let record: ApiKeyRecord | null;
    try {
      record = await db.validateApiKey(rawKey);
    } catch {
      res.status(503).json({ success: false, error: 'Auth lookup failed' });
      return;
    }

    const valid = record !== null && !isExpired(record);
    keyCache.set(rawKey, { record: valid ? record : null, expiry: now + KEY_CACHE_TTL_MS });

    if (!valid) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Fire-and-forget last_used_at update — don't block the request
    db.updateKeyLastUsed(record!.key_id).catch(() => undefined);

    attachContext(res, record!);
    next();
  };
}

function attachContext(res: Response, record: ApiKeyRecord): void {
  const ctx: KeyContext = {
    keyId: record.key_id,
    orgId: record.org_id,
    scopes: record.scopes,
  };
  res.locals['keyContext'] = ctx;
}

export function getKeyContext(res: Response): KeyContext {
  const ctx = res.locals['keyContext'] as KeyContext | undefined;
  if (!ctx) throw new Error('keyContext missing — requireApiKey middleware not applied');
  return ctx;
}

export function hasScope(res: Response, scope: string): boolean {
  const ctx = res.locals['keyContext'] as KeyContext | undefined;
  if (!ctx) return false;
  return ctx.scopes.includes('admin') || ctx.scopes.includes(scope);
}

// Sensitive span attribute keys — stripped from responses unless key has read:prompts scope
export const PROMPT_ATTRIBUTE_KEYS = new Set([
  'llm.prompt',
  'llm.completion',
  'gen_ai.prompt',
  'gen_ai.completion',
  'gen_ai.system',
  'input',
  'output',
]);

export function stripSensitiveAttributes(
  attributes: Record<string, string>,
  res: Response
): Record<string, string> {
  if (hasScope(res, 'read:prompts')) return attributes;
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (!PROMPT_ATTRIBUTE_KEYS.has(k)) filtered[k] = v;
  }
  return filtered;
}
