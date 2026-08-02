import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { logger } from '../utils/logger';

interface ScrapedPost {
  id: string;
  media_type: string;
  media_url: string;
  caption: string;
  timestamp: string;
  thumbnailUrl?: string;
}

// Random delay to mimic human behavior
function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Rotate user agents to avoid fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export class InstagramScraperService {
  private static browser: Browser | null = null;

  /**
   * Get or launch a shared browser instance.
   * Reusing the browser avoids the overhead of launching Chromium for every request.
   */
  private static async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      logger.info('Launching headless Chromium for Instagram scraping...');
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-blink-features=AutomationControlled',
        ],
      });
    }
    return this.browser;
  }

  /**
   * Create a stealth browser context that mimics a real user.
   */
  private static async createStealthContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      // Bypass Instagram's automation detection
      javaScriptEnabled: true,
      bypassCSP: true,
    });

    // Override navigator.webdriver to hide automation
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Override chrome detection
      (window as any).chrome = { runtime: {} };
      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: 'denied' } as PermissionStatus)
          : originalQuery(parameters);
      // Override plugins to look like a real browser
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });

    return context;
  }

  /**
   * Scrape Instagram posts/reels from a public profile using the Instagram private API.
   * This method intercepts the GraphQL network responses to extract post data.
   */
  static async scrapeProfile(username: string, limit: number = 20): Promise<ScrapedPost[]> {
    const cleanUsername = username.replace(/^@+/, '').trim();
    logger.info(`[CustomScraper] Starting scrape for @${cleanUsername}`);

    const browser = await this.getBrowser();
    const context = await this.createStealthContext(browser);
    const page = await context.newPage();

    const posts: ScrapedPost[] = [];
    let graphqlDataCaptured = false;

    try {
      // Intercept GraphQL responses that contain media data
      page.on('response', async (response) => {
        try {
          const url = response.url();
          if (url.includes('/graphql/query') || url.includes('/api/v1/users/')) {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('application/json')) {
              const json = await response.json().catch(() => null);
              if (json) {
                this.extractPostsFromGraphQL(json, posts, limit);
                if (posts.length > 0) {
                  graphqlDataCaptured = true;
                }
              }
            }
          }
        } catch {
          // Ignore response parsing errors
        }
      });

      // Navigate to the Instagram profile
      const profileUrl = `https://www.instagram.com/${cleanUsername}/`;
      logger.info(`[CustomScraper] Navigating to ${profileUrl}`);

      await page.goto(profileUrl, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait a bit for dynamic content
      await randomDelay(2000, 4000);

      // Check if we hit a login wall or private account
      const pageContent = await page.content();
      if (pageContent.includes('Login') && pageContent.includes('Sign up') && !pageContent.includes('article')) {
        logger.warn(`[CustomScraper] Login wall detected for @${cleanUsername}`);
      }

      // If GraphQL interception didn't capture data, try scraping the page directly
      if (!graphqlDataCaptured || posts.length === 0) {
        logger.info(`[CustomScraper] GraphQL capture empty, trying DOM extraction...`);
        const domPosts = await this.extractPostsFromDOM(page, cleanUsername);
        posts.push(...domPosts);
      }

      // If we still have no posts, try the Instagram private API endpoint directly
      if (posts.length === 0) {
        logger.info(`[CustomScraper] DOM extraction empty, trying private API...`);
        const apiPosts = await this.tryPrivateApi(page, cleanUsername, limit);
        posts.push(...apiPosts);
      }

      logger.info(`[CustomScraper] Scraped ${posts.length} posts for @${cleanUsername}`);

      // Return only videos/reels, up to the limit
      const videoPosts = posts.filter(p => p.media_type === 'VIDEO').slice(0, limit);
      logger.info(`[CustomScraper] Found ${videoPosts.length} video/reel posts`);

      return videoPosts;
    } catch (error) {
      logger.error({ error }, `[CustomScraper] Failed to scrape @${cleanUsername}`);
      throw error;
    } finally {
      await page.close();
      await context.close();
    }
  }

  /**
   * Extract post data from intercepted GraphQL JSON responses.
   */
  private static extractPostsFromGraphQL(json: any, posts: ScrapedPost[], limit: number): void {
    try {
      // Try multiple possible JSON paths where Instagram hides media data
      const possiblePaths = [
        json?.data?.user?.edge_owner_to_timeline_media?.edges,
        json?.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges,
        json?.graphql?.user?.edge_owner_to_timeline_media?.edges,
        json?.data?.user?.edge_felix_video_timeline?.edges,
        json?.items,
      ];

      for (const edges of possiblePaths) {
        if (!edges || !Array.isArray(edges)) continue;

        for (const edge of edges) {
          if (posts.length >= limit) return;

          const node = edge?.node || edge;
          if (!node) continue;

          const isVideo = node.is_video || node.media_type === 2 || node.product_type === 'clips' || node.video_url;

          if (isVideo) {
            const post: ScrapedPost = {
              id: node.id || node.pk || `ig_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              media_type: 'VIDEO',
              media_url: node.video_url || node.video_versions?.[0]?.url || '',
              caption:
                node.edge_media_to_caption?.edges?.[0]?.node?.text ||
                node.caption?.text ||
                node.caption ||
                '',
              timestamp: node.taken_at_timestamp
                ? new Date(node.taken_at_timestamp * 1000).toISOString()
                : node.taken_at
                  ? new Date(node.taken_at * 1000).toISOString()
                  : new Date().toISOString(),
              thumbnailUrl: node.display_url || node.thumbnail_src || node.image_versions2?.candidates?.[0]?.url,
            };

            // Avoid duplicates
            if (post.media_url && !posts.find(p => p.id === post.id)) {
              posts.push(post);
            }
          }
        }
      }
    } catch (err) {
      // Silently ignore parsing errors for individual GraphQL responses
    }
  }

  /**
   * Fallback: Extract posts by parsing the rendered DOM.
   * This works when GraphQL interception fails but the page rendered properly.
   */
  private static async extractPostsFromDOM(page: Page, username: string): Promise<ScrapedPost[]> {
    const posts: ScrapedPost[] = [];

    try {
      // Try to find the __additionalData or shared_data script
      const sharedData = await page.evaluate(() => {
        // Method 1: Check window._sharedData
        if ((window as any)._sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user) {
          return (window as any)._sharedData.entry_data.ProfilePage[0].graphql.user;
        }

        // Method 2: Check __additionalDataLoaded
        if ((window as any).__additionalDataLoaded) {
          const keys = Object.keys((window as any).__additionalDataLoaded);
          for (const key of keys) {
            const data = (window as any).__additionalDataLoaded[key];
            if (data?.graphql?.user) return data.graphql.user;
          }
        }

        // Method 3: Parse script tags for JSON data
        const scripts = document.querySelectorAll('script[type="application/json"]');
        for (const script of scripts) {
          try {
            const json = JSON.parse(script.textContent || '');
            // Look for user media data in the JSON
            const findMedia = (obj: any, depth: number = 0): any => {
              if (depth > 5 || !obj || typeof obj !== 'object') return null;
              if (obj.edge_owner_to_timeline_media?.edges) return obj;
              for (const key of Object.keys(obj)) {
                const result = findMedia(obj[key], depth + 1);
                if (result) return result;
              }
              return null;
            };
            const result = findMedia(json);
            if (result) return result;
          } catch {
            continue;
          }
        }

        return null;
      });

      if (sharedData?.edge_owner_to_timeline_media?.edges) {
        this.extractPostsFromGraphQL({ data: { user: sharedData } }, posts, 20);
      }
    } catch (err) {
      logger.warn(`[CustomScraper] DOM extraction failed for @${username}`);
    }

    return posts;
  }

  /**
   * Fallback: Try hitting Instagram's private web API directly from the browser context.
   */
  private static async tryPrivateApi(page: Page, username: string, limit: number): Promise<ScrapedPost[]> {
    const posts: ScrapedPost[] = [];

    try {
      // First, get the user ID
      const userInfo = await page.evaluate(async (uname: string) => {
        try {
          const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${uname}`, {
            headers: {
              'x-ig-app-id': '936619743392459',
              'x-requested-with': 'XMLHttpRequest',
            },
          });
          if (res.ok) {
            return await res.json();
          }
        } catch {
          return null;
        }
        return null;
      }, username);

      if (userInfo?.data?.user) {
        const user = userInfo.data.user;
        const edges = user.edge_owner_to_timeline_media?.edges || [];

        for (const edge of edges) {
          const node = edge.node;
          if (!node) continue;

          if (node.is_video) {
            // We need the video URL - fetch individual post
            const videoUrl = await this.fetchVideoUrl(page, node.shortcode);
            if (videoUrl) {
              posts.push({
                id: node.id,
                media_type: 'VIDEO',
                media_url: videoUrl,
                caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                timestamp: new Date(node.taken_at_timestamp * 1000).toISOString(),
                thumbnailUrl: node.display_url || node.thumbnail_src,
              });
            }
          }

          if (posts.length >= limit) break;
        }
      }
    } catch (err) {
      logger.warn(`[CustomScraper] Private API attempt failed for @${username}`);
    }

    return posts;
  }

  /**
   * Fetch the video URL for a specific post by its shortcode.
   */
  private static async fetchVideoUrl(page: Page, shortcode: string): Promise<string | null> {
    try {
      const postData = await page.evaluate(async (code: string) => {
        try {
          const res = await fetch(`https://www.instagram.com/api/v1/media/${code}/info/`, {
            headers: {
              'x-ig-app-id': '936619743392459',
              'x-requested-with': 'XMLHttpRequest',
            },
          });
          if (res.ok) {
            return await res.json();
          }
        } catch {
          return null;
        }
        return null;
      }, shortcode);

      if (postData?.items?.[0]?.video_versions) {
        return postData.items[0].video_versions[0].url;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  /**
   * Gracefully close the browser instance.
   */
  static async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('[CustomScraper] Browser closed');
    }
  }
}
