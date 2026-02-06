export interface BrowserAction {
  type: 'goto' | 'click' | 'type' | 'keys' | 'scroll' | 'wait' | 'pressEnter' | 'pressEscape' | 'screenshot';
  url?: string;
  selector?: string;
  text?: string;
  direction?: 'up' | 'down';
  timeout?: number;
}

export interface BrowserActionResult {
  action: BrowserAction;
  result: string;
  timestamp: number;
}

export interface PageStatus {
  exists: boolean;
  pageId?: string;
  url?: string;
  title?: string;
  error?: string;
}

export interface PageCandidate {
  selectorHints: string[];
  tag: string;
  placeholder?: string;
}

export interface PageHtmlResponse {
  success: boolean;
  pageId?: string;
  htmlLength?: number;
  htmlSnippet?: string;
  candidates?: PageCandidate[];
  error?: string;
}

export interface HealthStatus {
  status: string;
  sessionId: string;
  pages: number;
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
}

export interface AgentRequest {
  message: string;
  pageId?: string;
}

export interface AgentResponse {
  success: boolean;
  reply: string;
  sessionId: string;
  pageId: string;
  actionsLog: string[];
  actionCount: number;
  currentUrl: string;
  executionTime?: number;
  error?: string;
}

export interface ScreenshotResponse {
  success: boolean;
  filename?: string;
  url?: string;
  error?: string;
}

export interface AIResponse {
  actions: BrowserAction[];
}
