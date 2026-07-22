import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DatabaseService } from '../services/database.service';
import type { Logger } from '../services/logger';
import { getKeyContext } from '../middleware/auth';

type RequireApiKey = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function requireAdmin(res: Response): boolean {
  const ctx = getKeyContext(res);
  if (!ctx.scopes.includes('admin')) {
    res.status(403).json({ success: false, error: 'Requires admin scope' });
    return false;
  }
  return true;
}

export function createAdminRoutes(
  getDatabase: () => DatabaseService | null,
  requireApiKey: RequireApiKey,
  logger: Logger
): Router {
  const router = Router();

  function db(res: Response): DatabaseService | null {
    const d = getDatabase();
    if (!d) { res.status(503).json({ success: false, error: 'Service not available' }); return null; }
    return d;
  }

  // ── API key management ─────────────────────────────────────────────────────

  router.get('/keys', requireApiKey, async (_req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(res)) return;
    const d = db(res); if (!d) return;
    try {
      const ctx = getKeyContext(res);
      const result = await d.listApiKeys(ctx.orgId);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('Error listing keys:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });

  router.post('/keys', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(res)) return;
    const d = db(res); if (!d) return;
    try {
      const ctx = getKeyContext(res);
      const { name, scopes, expires_at } = req.body as {
        name?: string;
        scopes?: string[];
        expires_at?: string;
      };

      if (!name || typeof name !== 'string') {
        res.status(400).json({ success: false, error: 'name is required' });
        return;
      }

      const rawKey = `remi_${randomBytes(24).toString('hex')}`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      const allowedScopes = ['admin', 'read:sessions', 'read:spans', 'read:prompts', 'write:sessions'];
      const resolvedScopes = Array.isArray(scopes)
        ? scopes.filter((s) => allowedScopes.includes(s))
        : ['read:sessions', 'read:spans'];

      const keyId = await d.createApiKey({
        orgId: ctx.orgId,
        keyHash,
        name,
        scopes: resolvedScopes,
        expiresAt: typeof expires_at === 'string' ? expires_at : null,
        createdBy: ctx.keyId,
      });

      d.writeAuditLog({
        org_id: ctx.orgId,
        actor_key_id: ctx.keyId,
        action: 'create:api_key',
        resource_type: 'api_key',
        resource_id: keyId,
      }).catch(() => undefined);

      // Raw key is returned ONCE and never stored — caller must save it
      res.status(201).json({ success: true, data: { key_id: keyId, key: rawKey, scopes: resolvedScopes } });
    } catch (err) {
      logger.error('Error creating key:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });

  router.delete('/keys/:keyId', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(res)) return;
    const d = db(res); if (!d) return;
    const { keyId } = req.params as { keyId: string };
    try {
      const ctx = getKeyContext(res);
      await d.revokeApiKey(keyId, ctx.orgId);

      d.writeAuditLog({
        org_id: ctx.orgId,
        actor_key_id: ctx.keyId,
        action: 'revoke:api_key',
        resource_type: 'api_key',
        resource_id: keyId,
      }).catch(() => undefined);

      res.json({ success: true, key_id: keyId });
    } catch (err) {
      logger.error('Error revoking key:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });

  // ── PII policy management ──────────────────────────────────────────────────

  router.get('/pii-policy', requireApiKey, async (_req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(res)) return;
    const d = db(res); if (!d) return;
    try {
      const ctx = getKeyContext(res);
      const policy = await d.getPiiPolicy(ctx.orgId);
      res.json({ success: true, data: policy ?? { org_id: ctx.orgId, rules: [] } });
    } catch (err) {
      logger.error('Error fetching PII policy:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });

  router.put('/pii-policy', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(res)) return;
    const d = db(res); if (!d) return;
    try {
      const ctx = getKeyContext(res);
      const { rules } = req.body as { rules?: Array<{ pattern: string; label: string }> };
      if (!Array.isArray(rules)) {
        res.status(400).json({ success: false, error: 'rules must be an array' });
        return;
      }
      await d.upsertPiiPolicy(ctx.orgId, rules);

      d.writeAuditLog({
        org_id: ctx.orgId,
        actor_key_id: ctx.keyId,
        action: 'update:pii_policy',
        resource_type: 'pii_policy',
        resource_id: ctx.orgId,
        metadata: { rule_count: rules.length },
      }).catch(() => undefined);

      res.json({ success: true });
    } catch (err) {
      logger.error('Error updating PII policy:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });

  // ── Audit log ──────────────────────────────────────────────────────────────

  router.get('/audit-log', requireApiKey, async (req: Request, res: Response): Promise<void> => {
    if (!requireAdmin(res)) return;
    const d = db(res); if (!d) return;
    try {
      const ctx = getKeyContext(res);
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10) || 50, 500);
      const offset = parseInt(String(req.query['offset'] ?? '0'), 10) || 0;
      const entries = await d.getAuditLog(ctx.orgId, { limit, offset });
      res.json({ success: true, data: entries });
    } catch (err) {
      logger.error('Error fetching audit log:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  });

  return router;
}
