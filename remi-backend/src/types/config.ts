export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  openaiApiKey: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  corsOrigins: string[];
}
