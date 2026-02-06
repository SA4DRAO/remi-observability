import { Page } from 'puppeteer';
import type { BrowserAction } from '../types';
import { Logger } from './logger';

export class ActionExecutor {
  constructor(private logger: Logger) {}

  async executeAction(page: Page, action: BrowserAction): Promise<string> {
    try {
      switch (action.type) {
        case 'goto':
          return await this.handleGoto(page, action);

        case 'click':
          return await this.handleClick(page, action);

        case 'type':
          return await this.handleType(page, action);

        case 'keys':
          return await this.handleKeys(page, action);

        case 'scroll':
          return await this.handleScroll(page, action);

        case 'wait':
          return await this.handleWait(page, action);

        case 'pressEnter':
          await page.keyboard.press('Enter');
          return '⏎ Pressed Enter';

        case 'pressEscape':
          await page.keyboard.press('Escape');
          return '⎋ Pressed Escape';

        case 'screenshot':
          return await this.handleScreenshot(page);

        default:
          return '❓ Unknown action';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Action execution error (${action.type}):`, error);
      return `❌ Error: ${message}`;
    }
  }

  private async handleGoto(page: Page, action: BrowserAction): Promise<string> {
    if (!action.url) {
      return '❌ URL is required for goto action';
    }
    await page.bringToFront();
    await page.goto(action.url, {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });
    return `✅ Navigated to ${action.url}`;
  }

  private async handleClick(page: Page, action: BrowserAction): Promise<string> {
    if (!action.selector) {
      return '❌ Selector is required for click action';
    }

    try {
      await page.waitForSelector(action.selector, { timeout: 8000 });
      await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
        }
      }, action.selector);
      return `🖱️ Clicked ${action.selector}`;
    } catch {
      await page.click(action.selector);
      return `🖱️ Force-clicked ${action.selector}`;
    }
  }

  private async handleType(page: Page, action: BrowserAction): Promise<string> {
    if (!action.selector || action.text === undefined) {
      return '❌ Selector and text are required for type action';
    }

    try {
      await page.bringToFront();
      await this.tryAcceptConsent(page);
      await page.waitForSelector(action.selector, { timeout: 10000, visible: true });
      // Focus and clear existing content
      await page.focus(action.selector);
      // Select all and clear
      await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
      await page.keyboard.press('Backspace');
      
      await page.type(action.selector, action.text, { delay: 20 });
      return `⌨️ Typed "${action.text.substring(0, 30)}${action.text.length > 30 ? '...' : ''}"`;
    } catch {
      // Fallback: set value directly
      const exists = await page.evaluate(
        (sel: string) => !!document.querySelector(sel),
        action.selector
      );

      if (!exists) {
        return `❌ Type failed: selector not found`;
      }

      await page.evaluate(
        (sel: string, text: string) => {
          const el = document.querySelector(sel) as HTMLInputElement | null;
          if (el) {
            el.focus();
            el.value = '';
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
        action.selector,
        action.text
      );
      return `⌨️ Set value for ${action.selector} (fallback)`;
    }
  }

  private async handleKeys(page: Page, action: BrowserAction): Promise<string> {
    if (!action.text) {
      return '❌ Text is required for keys action';
    }
    await page.keyboard.type(action.text);
    return `⌨️ Keys: ${action.text}`;
  }

  private async handleScroll(page: Page, action: BrowserAction): Promise<string> {
    const scrollAmount = action.direction === 'down' ? 500 : -500;
    await page.evaluate((amount: number) => {
      window.scrollBy(0, amount);
    }, scrollAmount);
    return `📜 Scrolled ${action.direction || 'down'}`;
  }

  private async handleWait(_page: Page, action: BrowserAction): Promise<string> {
    const timeout = action.timeout || 1000;
    await new Promise(resolve => setTimeout(resolve, timeout));
    return `⏳ Waited ${timeout}ms`;
  }

  private async handleScreenshot(page: Page): Promise<string> {
    const timestamp = Date.now();
    const filename = `screenshot-${timestamp}.png`;
    const filepath = `./screenshots/${filename}`;
    
    const fs = await import('fs/promises');
    await fs.mkdir('./screenshots', { recursive: true });
    await page.screenshot({ path: filepath, fullPage: true });
    
    return `📸 Screenshot: ${filename}`;
  }

  // Try to accept common consent overlays (e.g., Google) that block typing/clicking
  private async tryAcceptConsent(page: Page): Promise<void> {
    try {
      const selectors = [
        '#L2AGLb', // Google "I agree"
        'button[aria-label="Accept all"]',
      ];
      for (const sel of selectors) {
        const found = await page.$(sel).then(Boolean).catch(() => false);
        if (found) {
          await page.click(sel).catch(() => {});
          await this.sleep(300);
          return;
        }
      }

      // Text-based fallback
      const clicked = await page.evaluate(() => {
        const match = (el: Element, texts: string[]) =>
          texts.some(t => (el.textContent || '').toLowerCase().includes(t));
        const texts = ['i agree', 'accept all', 'accept'];
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')) as HTMLElement[];
        for (const el of candidates) {
          if (match(el, texts)) {
            el.click();
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        await this.sleep(300);
      }
    } catch {
      // ignore
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}
