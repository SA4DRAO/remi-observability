import { Pool } from 'pg';
import { createHash } from 'crypto';
import type { Logger } from './logger';
import { parsePositiveInt } from '../config';

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
}

export interface ApiKeyRecord {
  key_id: string;
  org_id: string;
  scopes: string[];
  revoked_at: string | null;
  expires_at: string | null;
}

export interface AuditLogEntry {
  org_id: string;
  actor_key_id: string | null;
  action: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  request_id?: string;
  metadata?: Record<string, unknown>;
}

export interface PiiPolicy {
  policy_id: string;
  org_id: string;
  rules: Array<{ pattern: string; label: string }>;
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export class DatabaseService {
  private pool: Pool | null = null;
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    const config: DatabaseConfig = {
      host: process.env.DB_HOST ?? 'localhost',
      port: parsePositiveInt(process.env.DB_PORT, 5432, 'DB_PORT'),
      user: process.env.DB_USER ?? 'remi_user',
      password: process.env.DB_PASSWORD ?? '',
      database: process.env.DB_NAME ?? 'remi_db',
      max: parsePositiveInt(process.env.DB_POOL_MAX, 10, 'DB_POOL_MAX'),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    };

    this.pool = new Pool(config);
    await this.pool.query('SELECT 1');
    this.logger.info('PostgreSQL connected');
  }

  async disconnect(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  private getPool(): Pool {
    if (!this.pool) throw new Error('Database not initialized');
    return this.pool;
  }

  async validateApiKey(rawKey: string): Promise<ApiKeyRecord | null> {
    const hash = hashKey(rawKey);
    const result = await this.getPool().query<ApiKeyRecord>(
      `SELECT key_id, org_id, scopes, revoked_at, expires_at
       FROM api_keys
       WHERE key_hash = $1`,
      [hash]
    );
    return result.rows[0] ?? null;
  }

  async updateKeyLastUsed(keyId: string): Promise<void> {
    await this.getPool().query(
      `UPDATE api_keys SET last_used_at = NOW() WHERE key_id = $1`,
      [keyId]
    );
  }

  async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    await this.getPool().query(
      `INSERT INTO audit_log
         (org_id, actor_key_id, action, resource_type, resource_id,
          ip_address, user_agent, request_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.org_id,
        entry.actor_key_id,
        entry.action,
        entry.resource_type ?? null,
        entry.resource_id ?? null,
        entry.ip_address ?? null,
        entry.user_agent ?? null,
        entry.request_id ?? null,
        JSON.stringify(entry.metadata ?? {}),
      ]
    );
  }

  async getPiiPolicy(orgId: string): Promise<PiiPolicy | null> {
    const result = await this.getPool().query<PiiPolicy>(
      `SELECT policy_id, org_id, rules FROM pii_policies WHERE org_id = $1`,
      [orgId]
    );
    return result.rows[0] ?? null;
  }

  async upsertPiiPolicy(orgId: string, rules: Array<{ pattern: string; label: string }>): Promise<void> {
    await this.getPool().query(
      `INSERT INTO pii_policies (org_id, rules)
       VALUES ($1, $2::JSONB)
       ON CONFLICT (org_id) DO UPDATE SET rules = EXCLUDED.rules, updated_at = NOW()`,
      [orgId, JSON.stringify(rules)]
    );
  }

  // ── API key management ─────────────────────────────────────────────────────

  async listApiKeys(orgId: string): Promise<Omit<ApiKeyRecord, 'revoked_at'>[]> {
    const result = await this.getPool().query(
      `SELECT key_id, org_id, name, scopes, expires_at, last_used_at, created_at
       FROM api_keys
       WHERE org_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [orgId]
    );
    return result.rows as Omit<ApiKeyRecord, 'revoked_at'>[];
  }

  async createApiKey(params: {
    orgId: string;
    keyHash: string;
    name: string;
    scopes: string[];
    expiresAt: string | null;
    createdBy: string;
  }): Promise<string> {
    const result = await this.getPool().query<{ key_id: string }>(
      `INSERT INTO api_keys (org_id, key_hash, name, scopes, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING key_id`,
      [params.orgId, params.keyHash, params.name, params.scopes, params.expiresAt, params.createdBy]
    );
    return result.rows[0]!.key_id;
  }

  async revokeApiKey(keyId: string, orgId: string): Promise<void> {
    await this.getPool().query(
      `UPDATE api_keys SET revoked_at = NOW()
       WHERE key_id = $1 AND org_id = $2 AND revoked_at IS NULL`,
      [keyId, orgId]
    );
  }

  // ── Audit log read ─────────────────────────────────────────────────────────

  async getAuditLog(
    orgId: string,
    opts: { limit: number; offset: number }
  ): Promise<unknown[]> {
    const result = await this.getPool().query(
      `SELECT id, actor_key_id, action, resource_type, resource_id,
              ip_address, request_id, metadata, created_at
       FROM audit_log
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [orgId, opts.limit, opts.offset]
    );
    return result.rows;
  }
}
