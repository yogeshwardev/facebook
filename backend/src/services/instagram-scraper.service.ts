import { BrowserContext, Page } from 'playwright';
import { BrowserManager } from './browser-manager.service';
import { logger } from '../utils/logger';

export interface ExtractedPostMetadata {
  username: string;
  postUrl: string;
  shortcode: string;
  caption: string;
  thumbnailUrl: string;
  mediaType: 'POST' | 'REEL' | 'CAROUSEL';
  publishedAt?: Date;
}

export class InstagramScraperService {
  private browserManager: BrowserManager;

  constructor() {
    this.browserManager = BrowserManager.getInstance();
  }

  public static async scrapeProfile(username: string, limit: number = 20): Promise<any[]> {
    const service = new InstagramScraperService();
    return service.scrapeLatestPosts(username, limit);
  }

  public async scrapeLatestPosts(username: string, limit: number = 20): Promise<ExtractedPostMetadata[]> {
    const cleanUser = username.replace(/^@+/, '').trim();
    const context: BrowserContext = await this.browserManager.createContext();
    const page: Page = await context.newPage();

    try {
      const targetUrl = `https://www.instagram.com/${cleanUser}/`;
      logger.info(`[Playwright Scraper] Navigating to ${targetUrl}...`);

      const response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      if (response && response.status() === 404) {
        throw new Error(`Account @${cleanUser} not found (404).`);
      }

      // Check for private account indicator
      const isPrivate = await page.locator('text="This Account is Private"').count() > 0;
      if (isPrivate) {
        logger.warn(`Account @${cleanUser} is private. Cannot scrape metadata.`);
        return [];
      }

      // Wait for grid articles/links
      await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 15000 }).catch(() => {
        logger.warn(`No post links found for @${cleanUser}.`);
      });

      // Extract post metadata directly via Playwright DOM evaluation
      const rawPosts = await page.evaluate(({ user, maxLimit }: { user: string; maxLimit: number }) => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
        const uniqueLinks = new Map<string, Element>();

        for (const anchor of anchors) {
          const href = anchor.getAttribute('href');
          if (href && !uniqueLinks.has(href)) {
            uniqueLinks.set(href, anchor);
          }
          if (uniqueLinks.size >= maxLimit) break;
        }

        const results: Array<{
          username: string;
          postUrl: string;
          shortcode: string;
          caption: string;
          thumbnailUrl: string;
          mediaType: 'POST' | 'REEL' | 'CAROUSEL';
          publishedAtStr?: string;
        }> = [];

        uniqueLinks.forEach((anchor, href) => {
          const isReel = href.includes('/reel/');
          const shortcodeMatch = href.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
          const shortcode = shortcodeMatch ? shortcodeMatch[1] : '';

          if (!shortcode) return;

          const img = anchor.querySelector('img');
          const thumbnailUrl = img ? img.getAttribute('src') || '' : '';
          const caption = img ? img.getAttribute('alt') || '' : '';

          // Detect Carousel via multi-photo icon presence
          const isCarousel = anchor.querySelector('svg[aria-label*="Carousel"], svg[aria-label*="Multi"]') !== null;

          let mediaType: 'POST' | 'REEL' | 'CAROUSEL' = 'POST';
          if (isReel) mediaType = 'REEL';
          else if (isCarousel) mediaType = 'CAROUSEL';

          results.push({
            username: user,
            postUrl: `https://www.instagram.com${href}`,
            shortcode,
            caption,
            thumbnailUrl,
            mediaType,
          });
        });

        return results;
      }, { user: cleanUser, maxLimit: limit });

      return rawPosts.map((p: any) => ({
        ...p,
        publishedAt: p.publishedAtStr ? new Date(p.publishedAtStr) : new Date(),
      }));
    } catch (error: any) {
      logger.error(`Error scraping @${cleanUser}: ${error.message}`);
      throw error;
    } finally {
      await page.close();
      await context.close();
    }
  }
}
