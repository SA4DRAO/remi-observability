import { Router } from 'express';
import type { Request, Response } from 'express';
import { BrowserService, AIService, ActionExecutor } from '../services';
import { Logger } from '../services/logger';
import type { AgentResponse } from '../types';

export function createAgentRoutes(
  browserService: BrowserService,
  aiService: AIService,
  actionExecutor: ActionExecutor,
  logger: Logger
): Router {
  const router = Router();

  router.post('/agent', async (req: Request, res: Response): Promise<void> => {
    const { message, pageId = 'default' } = req.body;
    const startTime = Date.now();

    if (!message) {
      res.status(400).json({
        success: false,
        error: 'Message is required',
      });
      return;
    }

    try {
      const page = await browserService.getPage(pageId);

      // Build lightweight DOM context for AI to choose robust selectors
      type InputCand = { selectorHints: string[]; tag: string; placeholder?: string; label?: string };
      type ButtonCand = { selectorHints: string[]; tag: string; text?: string };
      type LinkCand = { selectorHints: string[]; tag: string; text?: string };

      const [url, title, context] = await Promise.all([
        page.url(),
        page.title(),
        page.evaluate(() => {
          const textOf = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
          const labelFor = (el: HTMLElement): string | null => {
            try {
              if (el.id) {
                const l = document.querySelector(`label[for="${el.id}"]`) as HTMLLabelElement | null;
                if (l) return (l.textContent || '').trim();
              }
              // find nearest label ancestor
              const lab = el.closest('label');
              if (lab) return (lab.textContent || '').trim();
              // aria-label
              const aria = el.getAttribute('aria-label');
              if (aria) return aria.trim();
              return null;
            } catch { return null; }
          };

          const hintParts = (el: HTMLElement) => {
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : null;
            const name = (el as HTMLInputElement).name ? `${tag}[name="${(el as HTMLInputElement).name}"]` : null;
            const classes = el.classList?.length ? `${tag}.${Array.from(el.classList).join('.')}` : null;
            const dataTestId = el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : null;
            return [name, id, classes, dataTestId].filter(Boolean) as string[];
          };

          const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'))
            .slice(0, 100)
            .map(el => {
              const htmlEl = el as HTMLElement;
              return {
                selectorHints: hintParts(htmlEl),
                tag: htmlEl.tagName.toLowerCase(),
                placeholder: (htmlEl as HTMLInputElement).getAttribute?.('placeholder') || undefined,
                label: labelFor(htmlEl) || undefined,
              };
            });

          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'))
            .slice(0, 100)
            .map(el => {
              const htmlEl = el as HTMLElement;
              return {
                selectorHints: hintParts(htmlEl),
                tag: htmlEl.tagName.toLowerCase(),
                text: textOf(htmlEl).slice(0, 80) || (htmlEl.getAttribute('value') || ''),
              };
            })
            .filter(b => (b.text || '').length > 0);

          const links = Array.from(document.querySelectorAll('a[href]'))
            .slice(0, 120)
            .map(el => {
              const htmlEl = el as HTMLElement;
              return {
                selectorHints: hintParts(htmlEl),
                tag: htmlEl.tagName.toLowerCase(),
                text: textOf(htmlEl).slice(0, 80),
              };
            })
            .filter(l => (l.text || '').length > 0);

          return { inputs, buttons, links };
        }) as Promise<{
          inputs: Array<Partial<InputCand> & { selectorHints: string[]; tag: string }>;
          buttons: Array<Partial<ButtonCand> & { selectorHints: string[]; tag: string }>;
          links: Array<Partial<LinkCand> & { selectorHints: string[]; tag: string }>;
        }>,
      ]);

      // Normalize to drop undefined properties (for exactOptionalPropertyTypes)
      const normalize = <T extends Record<string, any>>(o: T) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
        return out as T;
      };

      const actions = await aiService.getBrowserActions(message, {
        url,
        title,
        inputs: context.inputs.map(normalize) as InputCand[],
        buttons: context.buttons.map(normalize) as ButtonCand[],
        links: context.links.map(normalize) as LinkCand[],
      });
      const actionsLog: string[] = [];

      logger.info(`[${pageId}] Processing: "${message}" (${actions.length} actions)`);

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]!;
        const result = await actionExecutor.executeAction(page, action);
        actionsLog.push(`${i + 1}. ${result}`);
        logger.debug(`   ${result}`);

        if (i < actions.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      const currentUrl = await page.url();
      const executionTime = Date.now() - startTime;

      const response: AgentResponse = {
        success: true,
        reply: `Executed ${actions.length} actions on page "${pageId}"`,
        sessionId: String(Date.now()),
        pageId,
        actionsLog,
        actionCount: actions.length,
        currentUrl,
        executionTime,
      };

      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Agent error:', error);
      res.status(500).json({
        success: false,
        error: message,
      });
    }
  });

  return router;
}
