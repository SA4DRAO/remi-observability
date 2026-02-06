import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from './logger';

export class ScreenshotService {
  private screenshotDir = './screenshots';
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.ensureDirectory();
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.screenshotDir, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create screenshots directory:', error);
    }
  }

  async takeScreenshot(pageId: string): Promise<string> {
    const timestamp = Date.now();
    const filename = `screenshot-${pageId}-${timestamp}.png`;
    const filepath = path.join(this.screenshotDir, filename);
    
    this.logger.debug(`Taking screenshot: ${filename}`);
    return filepath;
  }

  async saveScreenshot(filepath: string, imageBuffer: Buffer): Promise<void> {
    await fs.writeFile(filepath, imageBuffer);
    this.logger.debug(`Screenshot saved: ${filepath}`);
  }

  getScreenshotUrl(filename: string, port: number): string {
    return `http://localhost:${port}/screenshots/${filename}`;
  }
}
