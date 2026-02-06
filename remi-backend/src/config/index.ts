import type { ServerConfig } from '../types/config';

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

function parseStringArray(value: string | undefined, defaultValue: string[]): string[] {
  if (!value) return defaultValue;
  return value.split(',').map(s => s.trim());
}

export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT || '3100', 10),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: (process.env.NODE_ENV as any) || 'development',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    corsOrigins: parseStringArray(
      process.env.CORS_ORIGINS,
      ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173']
    ),
    browser: {
      headless: parseBoolean(process.env.BROWSER_HEADLESS, true),
      timeout: parseInt(process.env.BROWSER_TIMEOUT || '15000', 10),
      sandbox: parseBoolean(process.env.BROWSER_SANDBOX, false),
      ...(process.env.BROWSER_EXECUTABLE_PATH && {
        executablePath: process.env.BROWSER_EXECUTABLE_PATH,
      }),
    },
  };
}

export function validateConfig(config: ServerConfig): void {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  if (config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }

  if (config.corsOrigins.length === 0) {
    throw new Error('At least one CORS origin must be specified');
  }
}
