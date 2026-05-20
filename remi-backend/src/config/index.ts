import type { ServerConfig } from '../types/config';

function parseStringArray(value: string | undefined, defaultValue: string[]): string[] {
  if (!value) return defaultValue;
  return value.split(',').map(s => s.trim());
}

export function parsePositiveInt(value: string | undefined, defaultValue: number, name: string): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

const NODE_ENVS = ['development', 'production', 'test'] as const;
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

function parseNodeEnv(value: string | undefined): ServerConfig['nodeEnv'] {
  return NODE_ENVS.includes(value as ServerConfig['nodeEnv'])
    ? (value as ServerConfig['nodeEnv'])
    : 'development';
}

function parseLogLevel(value: string | undefined): ServerConfig['logLevel'] {
  return LOG_LEVELS.includes(value as ServerConfig['logLevel'])
    ? (value as ServerConfig['logLevel'])
    : 'info';
}

export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT || '3100', 10),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: parseNodeEnv(process.env.NODE_ENV),
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    corsOrigins: parseStringArray(
      process.env.CORS_ORIGINS,
      ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173']
    ),
  };
}

export function validateConfig(config: ServerConfig): void {
  if (config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }

  if (config.corsOrigins.length === 0) {
    throw new Error('At least one CORS origin must be specified');
  }
}
