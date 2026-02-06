export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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

  debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      const msg = this.formatMessage('debug', message);
      console.log(msg, data ? data : '');
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      const msg = this.formatMessage('info', message);
      console.log(msg, data ? data : '');
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      const msg = this.formatMessage('warn', message);
      console.warn(msg, data ? data : '');
    }
  }

  error(message: string, error?: any): void {
    if (this.shouldLog('error')) {
      const msg = this.formatMessage('error', message);
      console.error(msg, error ? error : '');
    }
  }
}
