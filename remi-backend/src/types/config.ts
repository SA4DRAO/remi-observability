export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  openaiApiKey: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  corsOrigins: string[];
  browser: {
    headless: boolean;
    timeout: number;
    sandbox: boolean;
    executablePath?: string;
  };
}

export interface BrowserConfig {
  headless: boolean;
  timeout: number;
  sandbox: boolean;
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
  executablePath?: string;
}
