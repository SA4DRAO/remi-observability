import { Router } from 'express';
import type { Request, Response } from 'express';
import { BrowserService } from '../services';
import { Logger } from '../services/logger';

export function createPageRoutes(
  browserService: BrowserService,
  logger: Logger
): Router {
  const router = Router();

  // Create/initialize a new page session
  router.post('/pages', async (req: Request, res: Response): Promise<void> => {
    try {
      const requestedId = typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
        ? req.body.sessionId.trim()
        : 'default';

      const pageId = requestedId;
      const page = await browserService.getPage(pageId);
      const [url, title] = await Promise.all([page.url(), page.title()]);

      res.status(201).json({ id: pageId, url, title });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error initializing page session:', error);
      res.status(500).json({ success: false, error: message });
    }
  });

  router.get('/pages', (_req: Request, res: Response) => {
    const pages = browserService.getPageIds();
    res.json({
      pages,
      sessionId: String(Date.now()),
      totalPages: browserService.getPageCount(),
    });
  });

  router.get('/pages/:pageId', async (req: Request, res: Response): Promise<void> => {
    const pageId = typeof req.params.pageId === 'string' ? req.params.pageId : 'default';

    try {
      const pageStatus = await browserService.getPageStatus(pageId);

      if (!pageStatus) {
        res.json({
          exists: false,
          error: 'Page not found',
        });
        return;
      }

      res.json({
        exists: true,
        pageId,
        url: pageStatus.url,
        title: pageStatus.title,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error getting page status for ${pageId}:`, error);
      res.json({
        exists: false,
        error: message,
      });
    }
  });

  router.delete('/pages/:pageId', async (req: Request, res: Response): Promise<void> => {
    const pageId = typeof req.params.pageId === 'string' ? req.params.pageId : 'default';

    try {
      const closed = await browserService.closePage(pageId);

      if (closed) {
        res.json({
          success: true,
          message: `Closed page ${pageId}`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Page not found',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error closing page ${pageId}:`, error);
      res.status(500).json({
        success: false,
        error: message,
      });
    }
  });

  return router;
}
