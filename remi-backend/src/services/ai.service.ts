import OpenAI from 'openai';
import type { BrowserAction, AIResponse } from '../types';
import { Logger } from './logger';

export class AIService {
  private openai: OpenAI;
  private logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.openai = new OpenAI({ apiKey });
    this.logger = logger;
  }

  async getBrowserActions(
    message: string,
    pageContext?: {
      url: string;
      title: string;
      inputs: Array<{ selectorHints: string[]; tag: string; placeholder?: string; label?: string }>;
      buttons: Array<{ selectorHints: string[]; tag: string; text?: string }>;
      links: Array<{ selectorHints: string[]; tag: string; text?: string }>;
    }
  ): Promise<BrowserAction[]> {
    try {
      this.logger.debug(`Requesting AI actions for: "${message}"`);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a planner that converts a natural instruction into a minimal list of browser actions.
Rules:
- Respond ONLY with a compact JSON object. No markdown, no comments, no prose.
- Key: "actions": Array of action objects.
- Valid actions:
  - goto: {"type":"goto","url":"https://example.com"}
  - type: {"type":"type","selector":"css","text":"query"}
  - wait: {"type":"wait","timeout":1500}
  - pressEnter: {"type":"pressEnter"}
  - click: {"type":"click","selector":"css"}
  - scroll: {"type":"scroll","direction":"down"}
- Prefer the simplest path. If navigation is required, include a single goto.
Instruction: "${message}"`,
          },
          ...(pageContext
            ? [
                {
                  role: 'system' as const,
                  content:
                    'Page context (summarized). Use suitable selectors from hints when clicking/typing. If multiple matches, pick the most specific and likely visible one. Do NOT include this context in the JSON output.',
                },
                {
                  role: 'user' as const,
                  content: this.buildContextMessage(pageContext),
                },
              ]
            : []),
        ],
        temperature: 0,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        this.logger.warn('Empty response from OpenAI');
        return [];
      }

      this.logger.debug(`OpenAI JSON response: ${content}`);
      const json = this.extractJson(content);
      const parsed = JSON.parse(json) as AIResponse;
      return parsed.actions || [];
    } catch (error) {
      this.logger.error('OpenAI error:', error);
      return [{ type: 'wait', timeout: 1000 }];
    }
  }

  // Extract a JSON object safely from possible code fences or surrounding text
  private extractJson(content: string): string {
    // Strip code fences if present
    const fenced = content.trim().replace(/^```json\n?|```$/g, '').trim();
    try {
      JSON.parse(fenced);
      return fenced;
    } catch {}

    // Fallback: attempt to find outermost braces
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = fenced.slice(start, end + 1);
      JSON.parse(candidate);
      return candidate;
    }
    // As a last resort, return an empty actions array
    return '{"actions":[]}';
  }

  private buildContextMessage(ctx: {
    url: string;
    title: string;
    inputs: Array<{ selectorHints: string[]; tag: string; placeholder?: string; label?: string }>;
    buttons: Array<{ selectorHints: string[]; tag: string; text?: string }>;
    links: Array<{ selectorHints: string[]; tag: string; text?: string }>;
  }): string {
    const limit = <T,>(arr: T[], n: number) => arr.slice(0, n);
    const lines: string[] = [];
    lines.push(`URL: ${ctx.url}`);
    lines.push(`Title: ${ctx.title}`);
    lines.push('Inputs:');
    for (const it of limit(ctx.inputs, 40)) {
      lines.push(`- ${it.tag} hints=${JSON.stringify(it.selectorHints)} placeholder=${it.placeholder ?? ''} label=${it.label ?? ''}`);
    }
    lines.push('Buttons:');
    for (const it of limit(ctx.buttons, 40)) {
      lines.push(`- ${it.tag} text=${(it.text ?? '').slice(0, 60)} hints=${JSON.stringify(it.selectorHints)}`);
    }
    lines.push('Links:');
    for (const it of limit(ctx.links, 25)) {
      lines.push(`- ${it.tag} text=${(it.text ?? '').slice(0, 60)} hints=${JSON.stringify(it.selectorHints)}`);
    }
    return lines.join('\n');
  }
}
