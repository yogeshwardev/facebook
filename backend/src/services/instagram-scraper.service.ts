import { ApifyClient } from 'apify-client';
import { gotScraping } from 'got-scraping';
import { logger } from '../utils/logger';

/**
 * Standardized media item returned by all scraper strategies.
 * Matches the format expected by the frontend AccountFeedModal.
 */
export interface ScrapedMedia {
  id: string;
  media_type: string;       // VIDEO | IMAGE | CAROUSEL_ALBUM
  media_url: string;
  caption: string;
  timestamp: string;
  thumbnail_url: string;
  shortcode: string;
  permalink: string;
}

// Instagram Web App ID (public, used by instagram.com itself)
const IG_APP_ID = '936619743392459';

/**
 * InstagramScraperService
 * 
 * How online Instagram scrapers work:
 * 
 * 1. They DON'T use Playwright/Puppeteer on cloud servers (Instagram blocks datacenter IPs)
 * 2. They use Instagram's INTERNAL APIs with proper headers + TLS fingerprint spoofing
 * 3. They use RESIDENTIAL PROXIES or managed scraping services (Apify, Bright Data)
 * 4. They rotate session cookies from real accounts
 * 
 * This service implements 3 strategies in order of reliability:
 * 
 * Strategy 1: APIFY (most reliable, uses their proxy infrastructure)
 *   - Runs Instagram scraper on Apify's managed browser farm
 *   - No IP blocking, no login needed
 *   - Free tier: $5/month = ~2500 posts
 * 
 * Strategy 2: got-scraping + Instagram Internal API (needs INSTAGRAM_SESSION_ID)
 *   - Uses got-scraping library for TLS fingerprint bypass
 *   - Hits i.instagram.com/api/v1/ internal endpoints
 *   - Requires a session cookie from a real logged-in Instagram account
 * 
 * Strategy 3: got-scraping + __a=1 endpoint (limited, may work without auth)
 *   - Fallback using the ?__a=1&__d=dis JSON endpoint
 */
export class InstagramScraperService {

  /**
   * Main entry point - tries strategies in order of reliability
   */
  public static async scrapeProfile(username: string, limit: number = 20): Promise<ScrapedMedia[]> {
    const cleanUser = username.replace(/^@+/, '').trim();
    logger.info(`[Scraper] Starting multi-strategy scrape for @${cleanUser}`);

    // Strategy 1: Apify (most reliable — this is how online scrapers work)
    if (process.env.APIFY_TOKEN) {
      try {
        const results = await InstagramScraperService.viaApify(cleanUser, limit);
        if (results.length > 0) {
          logger.info(`[Scraper] ✅ Apify returned ${results.length} items for @${cleanUser}`);
          return results;
        }
      } catch (err: any) {
        logger.warn(`[Scraper] Apify failed for @${cleanUser}: ${err.message}`);
      }
    } else {
      logger.info(`[Scraper] APIFY_TOKEN not set, skipping Apify strategy`);
    }

    // Strategy 2: Instagram Internal API via got-scraping (needs session cookie)
    if (process.env.INSTAGRAM_SESSION_ID) {
      try {
        const results = await InstagramScraperService.viaInternalAPI(cleanUser, limit);
        if (results.length > 0) {
          logger.info(`[Scraper] ✅ Internal API returned ${results.length} items for @${cleanUser}`);
          return results;
        }
      } catch (err: any) {
        logger.warn(`[Scraper] Internal API failed for @${cleanUser}: ${err.message}`);
      }
    } else {
      logger.info(`[Scraper] INSTAGRAM_SESSION_ID not set, skipping Internal API strategy`);
    }

    // Strategy 3: __a=1 endpoint via got-scraping (may work without auth)
    try {
      const results = await InstagramScraperService.viaJsonEndpoint(cleanUser, limit);
      if (results.length > 0) {
        logger.info(`[Scraper] ✅ JSON endpoint returned ${results.length} items for @${cleanUser}`);
        return results;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] JSON endpoint failed for @${cleanUser}: ${err.message}`);
    }

    logger.error(`[Scraper] ❌ ALL strategies failed for @${cleanUser}. Configure APIFY_TOKEN or INSTAGRAM_SESSION_ID in .env`);
    return [];
  }

  // ═══════════════════════════════════════════════════════════════
  // STRATEGY 1: APIFY — How online scrapers actually work
  // Runs on Apify's managed infrastructure with residential proxies
  // ═══════════════════════════════════════════════════════════════
  private static async viaApify(username: string, limit: number): Promise<ScrapedMedia[]> {
    const client = new ApifyClient({ token: process.env.APIFY_TOKEN! });

    logger.info(`[Apify] Running instagram-scraper actor for @${username}...`);

    const input = {
      directUrls: [`https://www.instagram.com/${username}/`],
      resultsType: 'posts',
      resultsLimit: limit,
      searchType: 'user',
    };

    // Run the actor on Apify's cloud (takes 30-90 seconds)
    const run = await client.actor('apify/instagram-scraper').call(input, {
      timeout: 120,
      waitForFinishSecs: 120,
    } as any);

    // Fetch results from the dataset
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    logger.info(`[Apify] Actor returned ${items.length} raw items for @${username}`);

    return items.map((item: any) => InstagramScraperService.parseApifyItem(item, username));
  }

  // ═══════════════════════════════════════════════════════════════
  // STRATEGY 2: Instagram Internal Web API
  // Uses got-scraping for TLS fingerprint bypass + session cookie
  // ═══════════════════════════════════════════════════════════════
  private static async viaInternalAPI(username: string, limit: number): Promise<ScrapedMedia[]> {
    const sessionId = process.env.INSTAGRAM_SESSION_ID!.trim();

    const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`;

    logger.info(`[InternalAPI] Fetching profile for @${username}...`);

    const response = await gotScraping({
      url,
      headers: {
        'x-ig-app-id': IG_APP_ID,
        'x-ig-www-claim': '0',
        'x-requested-with': 'XMLHttpRequest',
        'Cookie': `sessionid=${sessionId}`,
        'Referer': `https://www.instagram.com/${username}/`,
        'Origin': 'https://www.instagram.com',
      },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 126 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
      timeout: { request: 20000 },
      retry: { limit: 2 },
    });

    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode}`);
    }

    const data = JSON.parse(response.body);
    const user = data?.data?.user;
    if (!user) throw new Error('No user data in response');

    const edges = user?.edge_owner_to_timeline_media?.edges || [];
    logger.info(`[InternalAPI] Found ${edges.length} media edges for @${username}`);

    return edges.slice(0, limit).map((edge: any) => InstagramScraperService.parseGraphEdge(edge.node, username));
  }

  // ═══════════════════════════════════════════════════════════════
  // STRATEGY 3: ?__a=1&__d=dis JSON endpoint
  // Last resort fallback
  // ═══════════════════════════════════════════════════════════════
  private static async viaJsonEndpoint(username: string, limit: number): Promise<ScrapedMedia[]> {
    const url = `https://www.instagram.com/${username}/?__a=1&__d=dis`;

    logger.info(`[JSONEndpoint] Fetching @${username} via __a=1...`);

    const headers: Record<string, string> = {
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.instagram.com/',
    };

    if (process.env.INSTAGRAM_SESSION_ID) {
      headers['Cookie'] = `sessionid=${process.env.INSTAGRAM_SESSION_ID.trim()}`;
    }

    const response = await gotScraping({
      url,
      headers,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 126 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
      timeout: { request: 15000 },
      retry: { limit: 2 },
    });

    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode}`);
    }

    const data = JSON.parse(response.body);
    const user = data?.graphql?.user || data?.data?.user;
    if (!user) throw new Error('No user data');

    const edges = user?.edge_owner_to_timeline_media?.edges || [];
    return edges.slice(0, limit).map((edge: any) => InstagramScraperService.parseGraphEdge(edge.node, username));
  }

  // ═══════════════════════════════════════════════════════════════
  // PARSERS — Convert raw API responses to standardized ScrapedMedia
  // ═══════════════════════════════════════════════════════════════

  /**
   * Parse Apify actor output item
   */
  private static parseApifyItem(item: any, username: string): ScrapedMedia {
    // Determine media type
    let mediaType = 'IMAGE';
    if (item.videoUrl || item.type === 'Video' || item.productType === 'clips' || item.productType === 'feed') {
      if (item.videoUrl || item.type === 'Video' || item.productType === 'clips') {
        mediaType = 'VIDEO';
      }
    }
    if (item.type === 'Sidecar' || item.childPosts?.length > 0) {
      mediaType = 'CAROUSEL_ALBUM';
    }

    const shortcode = item.shortCode || item.shortcode || item.code || '';
    const timestamp = item.timestamp
      ? new Date(item.timestamp).toISOString()
      : new Date().toISOString();

    return {
      id: item.id || shortcode,
      media_type: mediaType,
      media_url: item.videoUrl || item.displayUrl || item.url || '',
      caption: item.caption || item.text || '',
      timestamp,
      thumbnail_url: item.displayUrl || item.thumbnailUrl || '',
      shortcode,
      permalink: item.url || `https://www.instagram.com/p/${shortcode}/`,
    };
  }

  /**
   * Parse Instagram GraphQL edge node (used by Internal API and __a=1)
   */
  private static parseGraphEdge(node: any, username: string): ScrapedMedia {
    let mediaType = 'IMAGE';
    if (node.is_video || node.__typename === 'GraphVideo' || node.product_type === 'clips') {
      mediaType = 'VIDEO';
    } else if (node.__typename === 'GraphSidecar' || node.edge_sidecar_to_children) {
      mediaType = 'CAROUSEL_ALBUM';
    }

    const shortcode = node.shortcode || '';
    const timestamp = node.taken_at_timestamp
      ? new Date(node.taken_at_timestamp * 1000).toISOString()
      : new Date().toISOString();

    return {
      id: node.id || shortcode,
      media_type: mediaType,
      media_url: node.video_url || node.display_url || node.thumbnail_src || '',
      caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
      timestamp,
      thumbnail_url: node.thumbnail_src || node.display_url || '',
      shortcode,
      permalink: `https://www.instagram.com/p/${shortcode}/`,
    };
  }
}
