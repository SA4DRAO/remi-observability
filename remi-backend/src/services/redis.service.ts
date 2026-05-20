import { createClient } from 'redis';
import { Logger } from './logger';

export class RedisService {
  private client: ReturnType<typeof createClient> | null = null;
  private logger: Logger;
  private defaultTTL: number = 3600; // 1 hour

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    const host = process.env.REDIS_HOST || 'redis-cache';
    const port = parseInt(process.env.REDIS_PORT || '6379');
    const password = process.env.REDIS_PASSWORD;

    const options: any = {
      socket: {
        host,
        port,
        reconnectStrategy: (retries: number) => {
          if (retries > 10) return new Error('Max retries reached');
          return Math.min(retries * 50, 500);
        },
      },
    };

    if (password) {
      options.password = password;
    }

    this.client = createClient(options);

    try {
      await this.client.connect();
      this.logger.info('Redis cache connected');
    } catch (error) {
      this.logger.error('Failed to connect Redis cache:', error);
      this.client = null;
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  async getJSON<T = any>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) {
      this.logger.debug('Redis cache miss', { key });
      return null;
    }
    try {
      this.logger.debug('Redis cache hit', { key });
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Cache JSON parse error for key ${key}:`, error);
      return null;
    }
  }

  async set(
    key: string,
    value: string,
    ttlSeconds?: number
  ): Promise<void> {
    if (!this.client) return;
    try {
      const ttl = ttlSeconds || this.defaultTTL;
      await this.client.setEx(key, ttl, value);
      this.logger.debug('Redis cache set', {
        key,
        ttl,
        bytes: value.length,
      });
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}:`, error);
    }
  }

  async setJSON<T = any>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    if (!this.client) return;
    
    const serialized = JSON.stringify(value);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    
    // Skip caching if value exceeds 5MB (prevent Redis OOM)
    const MAX_CACHE_VALUE_BYTES = parseInt(process.env.REDIS_MAX_VALUE_BYTES || '5242880');
    if (bytes > MAX_CACHE_VALUE_BYTES) {
      this.logger.warn('Cache value too large, skipping', {
        key,
        sizeBytes: bytes,
        limitBytes: MAX_CACHE_VALUE_BYTES,
      });
      return;
    }
    
    try {
      const ttl = ttlSeconds ?? this.defaultTTL;
      await this.client.setEx(key, ttl, serialized);
    } catch (error) {
      this.logger.error(`Cache set error for key ${key}:`, error);
    }
  }

  async del(key: string | string[]): Promise<void> {
    if (!this.client) return;
    try {
      const keys = Array.isArray(key) ? key : [key];
      await this.client.del(keys);
    } catch (error) {
      this.logger.error(`Cache del error:`, error);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    if (!this.client) return;
    try {
      // Use SCAN instead of KEYS to avoid blocking Redis on large keyspaces
      let cursor = '0';
      let scanned = 0;
      let deleted = 0;
      do {
        const result = await this.client.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor;
        scanned += result.keys.length;
        if (result.keys.length > 0) {
          await this.client.del(result.keys);
          deleted += result.keys.length;
        }
      } while (cursor !== '0');
      this.logger.debug('Redis pattern invalidation complete', {
        pattern,
        scanned,
        deleted,
      });
    } catch (error) {
      this.logger.error(`Cache invalidate pattern error:`, error);
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (!this.client) return keys.map(() => null);
    try {
      return await this.client.mGet(keys);
    } catch (error) {
      this.logger.error(`Cache mget error:`, error);
      return keys.map(() => null);
    }
  }

  async incr(key: string): Promise<number> {
    if (!this.client) return 0;
    try {
      return await this.client.incr(key);
    } catch (error) {
      this.logger.error(`Cache incr error for key ${key}:`, error);
      return 0;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.expire(key, ttlSeconds);
      return Boolean(result);
    } catch (error) {
      this.logger.error(`Cache expire error for key ${key}:`, error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.logger.info('Redis cache disconnected');
    }
  }
}
