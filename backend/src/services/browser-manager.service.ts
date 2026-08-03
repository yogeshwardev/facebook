import { Browser, BrowserContext, Route } from 'playwright';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

chromium.use(stealthPlugin());

export class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;
  private storageStatePath: string;

  private constructor() {
    this.storageStatePath = path.resolve(process.cwd(), 'storageState.json');
  }

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  public async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      logger.info('Initializing Playwright Chromium Stealth Browser Instance...');
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--lang=en-US,en',
        ],
      });
    }
    return this.browser;
  }

  public async createContext(options: { blockAssets?: boolean } = {}): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const hasStorage = fs.existsSync(this.storageStatePath);

    const contextOptions: any = {
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    };

    if (hasStorage) {
      contextOptions.storageState = this.storageStatePath;
    }

    const context = await browser.newContext(contextOptions);

    if (process.env.INSTAGRAM_SESSION_ID) {
      await context.addCookies([{
        name: 'sessionid',
        value: process.env.INSTAGRAM_SESSION_ID.trim(),
        domain: '.instagram.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      }]);
    }

    if (options.blockAssets !== false) {
      // Abort image and media binary downloads to save memory & bandwidth.
      await context.route('**/*', (route: Route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
          return route.abort();
        }
        return route.continue();
      });
    }

    return context;
  }

  public async saveStorageState(context: BrowserContext): Promise<void> {
    await context.storageState({ path: this.storageStatePath });
    logger.info(`Session storageState saved to ${this.storageStatePath}`);
  }

  public async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Browser instance closed.');
    }
  }
}
