export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

export class Logger {
  private level: LogLevel;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    return `[${timestamp}] ${levelStr} ${message}`;
  }

  private serializeContext(data?: unknown): string {
    if (data === undefined) return '';
    if (data instanceof Error) {
      return JSON.stringify({
        name: data.name,
        message: data.message,
        stack: data.stack,
      });
    }
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data);
    } catch {
      return String(data);
    }
  }

  child(baseContext: LogContext): {
    debug: (message: string, data?: unknown) => void;
    info: (message: string, data?: unknown) => void;
    warn: (message: string, data?: unknown) => void;
    error: (message: string, data?: unknown) => void;
  } {
    const withContext = (data?: unknown) => {
      if (data === undefined) return baseContext;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return { ...baseContext, ...(data as Record<string, unknown>) };
      }
      return { ...baseContext, data };
    };

    return {
      debug: (message: string, data?: unknown) => this.debug(message, withContext(data)),
      info: (message: string, data?: unknown) => this.info(message, withContext(data)),
      warn: (message: string, data?: unknown) => this.warn(message, withContext(data)),
      error: (message: string, data?: unknown) => this.error(message, withContext(data)),
    };
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      const msg = this.formatMessage('debug', message);
      const context = this.serializeContext(data);
      console.log(context ? `${msg} ${context}` : msg);
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      const msg = this.formatMessage('info', message);
      const context = this.serializeContext(data);
      console.log(context ? `${msg} ${context}` : msg);
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      const msg = this.formatMessage('warn', message);
      const context = this.serializeContext(data);
      console.warn(context ? `${msg} ${context}` : msg);
    }
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      const msg = this.formatMessage('error', message);
      const context = this.serializeContext(error);
      console.error(context ? `${msg} ${context}` : msg);
    }
  }
}
