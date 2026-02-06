import { Page, Browser } from 'puppeteer';
import puppeteer from 'puppeteer';
import type { BrowserConfig } from '../types/config';
import { Logger } from './logger';
import { existsSync } from 'fs';

export class BrowserService {
  private static instance: BrowserService;
  private browser: Browser | null = null;
  private pages: Map<string, Page> = new Map();
  private config: BrowserConfig;
  private logger: Logger;

  private constructor(config: BrowserConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  static getInstance(config: BrowserConfig, logger: Logger): BrowserService {
    if (!BrowserService.instance) {
      BrowserService.instance = new BrowserService(config, logger);
    }
    return BrowserService.instance;
  }

  async initBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.logger.info(`Initializing browser (headless=${this.config.headless})...`);
      try {
        const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY;
        const headless = this.config.headless;
        const baseArgs: string[] = [
          // Security flags: disable sandbox only when explicitly configured
          !this.config.sandbox && '--no-sandbox',
          !this.config.sandbox && '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-web-security',
          '--disable-blink-features=AutomationControlled',
        ].filter(Boolean) as string[];

        // On headful sessions, prefer showing a window nicely
        if (!headless) {
          baseArgs.push('--start-maximized');
          if (isWayland) {
            baseArgs.push('--ozone-platform=wayland');
          }
        } else {
          // Headless-only safe option
          baseArgs.push('--disable-gpu');
        }

        const launchOptions: any = {
          headless,
          args: baseArgs,
          // In headful mode, let Chrome manage the viewport (full window size)
          ...(headless ? {} : { defaultViewport: null }),
        };

        // Resolve executable path preference: config -> env -> common paths
        let resolvedExecutable = this.config.executablePath || process.env.PUPPETEER_EXECUTABLE_PATH;
        if (!resolvedExecutable) {
          const candidates = [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable'
          ];
          resolvedExecutable = candidates.find(p => existsSync(p));
        }

        // Fall back to Puppeteer's managed Chrome if available
        if (!resolvedExecutable) {
          try {
            // In modern puppeteer, this points to the Chrome for Testing that puppeteer downloads
            resolvedExecutable = puppeteer.executablePath();
          } catch (_err) {
            // ignore and let puppeteer pick default
          }
        }

        if (resolvedExecutable) {
          launchOptions.executablePath = resolvedExecutable;
          this.logger.debug(`Using chromium at: ${resolvedExecutable}`);
        }

        this.browser = await puppeteer.launch(launchOptions);
        try {
          const version = await this.browser.version();
          this.logger.info(`Browser initialized successfully (${version})`);
        } catch {
          this.logger.info('Browser initialized successfully');
        }

        this.browser.on('disconnected', () => {
          this.logger.warn('Browser disconnected. Clearing page cache...');
          this.pages.clear();
          this.browser = null;
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to launch browser: ${errorMessage}`);
        throw new Error(`Browser launch failed: ${errorMessage}. Make sure chromium/chrome is installed or set BROWSER_EXECUTABLE_PATH environment variable.`);
      }
    }
    return this.browser;
  }

  async getPage(pageId: string = 'default'): Promise<Page> {
    await this.initBrowser();

    if (!this.pages.has(pageId)) {
      this.logger.debug(`Creating new page: ${pageId}`);
      const newPage = await this.browser!.newPage();

      const viewport = this.config.viewport || { width: 1366, height: 768 };
      await newPage.setViewport(viewport);

      const userAgent =
        this.config.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      await newPage.setUserAgent(userAgent);

      await newPage.setDefaultTimeout(this.config.timeout);

      try {
        await newPage.setBypassCSP(true);
        await newPage.bringToFront();
      } catch (e) {
        this.logger.warn('Could not adjust page CSP or bring to front', e);
      }

      this.pages.set(pageId, newPage);
      this.logger.debug(`Page created: ${pageId}`);
    }

    return this.pages.get(pageId)!;
  }

  async closePage(pageId: string): Promise<boolean> {
    const page = this.pages.get(pageId);
    if (page) {
      await page.close();
      this.pages.delete(pageId);
      this.logger.debug(`Page closed: ${pageId}`);
      return true;
    }
    return false;
  }

  getPageIds(): string[] {
    return Array.from(this.pages.keys());
  }

  async getPageStatus(pageId: string): Promise<{ exists: boolean; url?: string; title?: string } | null> {
    const page = this.pages.get(pageId);
    if (!page) {
      return null;
    }
    try {
      const [url, title] = await Promise.all([page.url(), page.title()]);
      return { exists: true, url, title };
    } catch (error) {
      this.logger.error(`Error getting page status for ${pageId}:`, error);
      return null;
    }
  }

  getPageCount(): number {
    return this.pages.size;
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down browser service...');
    for (const [id, page] of this.pages) {
      try {
        await page.close();
        this.logger.debug(`Closed page: ${id}`);
      } catch (error) {
        this.logger.error(`Error closing page ${id}:`, error);
      }
    }
    this.pages.clear();

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.logger.info('Browser closed');
    }
  }
}
