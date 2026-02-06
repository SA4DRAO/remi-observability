import { Router } from 'express';
import type { Request, Response } from 'express';
import { BrowserService, ScreenshotService } from '../services';
import { Logger } from '../services/logger';
import { promises as fs } from 'fs';

export function createScreenshotRoutes(
  browserService: BrowserService,
  screenshotService: ScreenshotService,
  logger: Logger,
  port: number
): Router {
  const router = Router();

  router.post('/screenshot/:pageId', async (req: Request, res: Response): Promise<void> => {
    const pageId = typeof req.params.pageId === 'string' ? req.params.pageId : 'default';

    try {
      const page = await browserService.getPage(pageId);
      const timestamp = Date.now();
      const filename = `screenshot-${pageId}-${timestamp}.png`;
      const filepath = `./screenshots/${filename}`;

      await fs.mkdir('./screenshots', { recursive: true });
      await page.screenshot({ path: filepath, fullPage: true });

      res.json({
        success: true,
        filename,
        url: screenshotService.getScreenshotUrl(filename, port),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error taking screenshot for ${pageId}:`, error);
      res.status(500).json({
        success: false,
        error: message,
      });
    }
  });

  router.get('/html/:pageId', async (req: Request, res: Response): Promise<void> => {
    const pageId = typeof req.params.pageId === 'string' ? req.params.pageId : 'default';

    try {
      const page = await browserService.getPage(pageId);
      const html = await page.content();

      const candidates = await page.evaluate(() => {
        const elements = Array.from(
          document.querySelectorAll('input, textarea, [contenteditable="true"]')
        ) as Element[];
        return elements.map((el: Element) => {
          const htmlEl = el as HTMLElement;
          const tag = htmlEl.tagName.toLowerCase();
          const id = htmlEl.id ? `#${htmlEl.id}` : null;
          const name = (htmlEl as HTMLInputElement).getAttribute?.('name')
            ? `input[name="${(htmlEl as HTMLInputElement).getAttribute('name')}"]`
            : null;
          const classes = htmlEl.classList?.length
            ? `${tag}.${Array.from(htmlEl.classList).join('.')}`
            : null;
          const placeholder = htmlEl.getAttribute?.('placeholder') || null;

          return {
            selectorHints: [name, id, classes].filter(Boolean),
            tag,
            placeholder,
          };
        });
      });

      res.json({
        success: true,
        pageId,
        htmlLength: html.length,
        htmlSnippet: html.slice(0, 2000),
        candidates,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error getting HTML for ${pageId}:`, error);
      res.status(500).json({
        success: false,
        error: message,
      });
    }
  });

  return router;
}
