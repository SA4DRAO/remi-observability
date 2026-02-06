/**
 * Agent-related type definitions
 */

export interface AgentResponse {
  success: boolean;
  reply: string;
  actionsLog: string[];
  sessionId: string;
  pageId: string;
  actionCount: number;
  currentUrl: string;
  error?: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "agent";
  content: string;
  pageId?: string;
  currentUrl?: string;
  timestamp: Date;
}

export interface PageInfo {
  id: string;
  title?: string;
  url?: string;
}
