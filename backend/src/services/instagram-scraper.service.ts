import { gotScraping } from 'got-scraping';
import { logger } from '../utils/logger';

export interface ScrapedMedia {
  id: string;
  media_type: string;       // VIDEO | IMAGE | CAROUSEL_ALBUM
  media_url: string;
  caption: string;
  timestamp: string;
  thumbnail_url?: string;
  shortcode: string;
  permalink: string;
}

const IG_APP_ID = '936619743392459';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const MOBILE_UA = 'Instagram 330.0.0.0.52 Android (33/13; 440dpi; 1080x2400; samsung; SM-G998B; r9q; qcom; en_US; 599820000)';

export class InstagramScraperService {

  /**
   * Main entry point - tries multiple strategies in order
   */
  public static async scrapeProfile(username: string, limit: number = 20): Promise<ScrapedMedia[]> {
    const cleanUser = username.replace(/^@+/, '').trim();
    logger.info(`[Scraper] Starting scrape for @${cleanUser} with limit ${limit}`);

    // Strategy 1: Instagram Web Profile Info API (via got-scraping for TLS fingerprint bypass)
    try {
      const results = await InstagramScraperService.viaWebProfileAPI(cleanUser, limit);
      if (results.length > 0) {
        logger.info(`[Scraper] Web Profile API returned ${results.length} items for @${cleanUser}`);
        return results;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Web Profile API failed for @${cleanUser}: ${err.message}`);
    }

    // Strategy 2: Instagram GraphQL query via got-scraping
    try {
      const results = await InstagramScraperService.viaGraphQL(cleanUser, limit);
      if (results.length > 0) {
        logger.info(`[Scraper] GraphQL API returned ${results.length} items for @${cleanUser}`);
        return results;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] GraphQL API failed for @${cleanUser}: ${err.message}`);
    }

    // Strategy 3: Instagram Mobile API via got-scraping
    try {
      const results = await InstagramScraperService.viaMobileAPI(cleanUser, limit);
      if (results.length > 0) {
        logger.info(`[Scraper] Mobile API returned ${results.length} items for @${cleanUser}`);
        return results;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Mobile API failed for @${cleanUser}: ${err.message}`);
    }

    // Strategy 4: Instagram Embed endpoint (no auth needed, limited data)
    try {
      const results = await InstagramScraperService.viaEmbed(cleanUser);
      if (results.length > 0) {
        logger.info(`[Scraper] Embed API returned ${results.length} items for @${cleanUser}`);
        return results;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Embed API failed for @${cleanUser}: ${err.message}`);
    }

    logger.error(`[Scraper] All strategies failed for @${cleanUser}`);
    return [];
  }

  /**
   * Strategy 1: Instagram Web Profile Info API
   * Uses got-scraping to bypass TLS fingerprinting
   */
  private static async viaWebProfileAPI(username: string, limit: number): Promise<ScrapedMedia[]> {
    const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`;

    const headers: Record<string, string> = {
      'x-ig-app-id': IG_APP_ID,
      'x-ig-www-claim': '0',
      'x-requested-with': 'XMLHttpRequest',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': `https://www.instagram.com/${username}/`,
      'Origin': 'https://www.instagram.com',
    };

    // If INSTAGRAM_SESSION_ID is set, use it as cookie for authenticated access
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
      throw new Error(`HTTP ${response.statusCode} from web_profile_info`);
    }

    const data = JSON.parse(response.body);
    const user = data?.data?.user;
    if (!user) {
      throw new Error('No user data in response');
    }

    const edges = user?.edge_owner_to_timeline_media?.edges || [];
    return edges.slice(0, limit).map((edge: any) => InstagramScraperService.parseGraphEdge(edge.node, username));
  }

  /**
   * Strategy 2: Instagram GraphQL query
   */
  private static async viaGraphQL(username: string, limit: number): Promise<ScrapedMedia[]> {
    // First get user ID
    const userIdResponse = await gotScraping({
      url: `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      headers: {
        'x-ig-app-id': IG_APP_ID,
        'User-Agent': DESKTOP_UA,
        ...(process.env.INSTAGRAM_SESSION_ID ? { 'Cookie': `sessionid=${process.env.INSTAGRAM_SESSION_ID.trim()}` } : {}),
      },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 126 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
      timeout: { request: 15000 },
    });

    if (userIdResponse.statusCode !== 200) {
      throw new Error(`HTTP ${userIdResponse.statusCode} getting user ID`);
    }

    const userData = JSON.parse(userIdResponse.body);
    const userId = userData?.data?.user?.id;
    if (!userId) {
      throw new Error('Could not find user ID');
    }

    // Now query the media with GraphQL
    const variables = JSON.stringify({
      id: userId,
      first: limit,
    });

    // doc_id for PolarisProfilePostsQuery (may need periodic update)
    const docId = '17991233890457762';

    const graphqlUrl = `https://www.instagram.com/graphql/query/?query_hash=${docId}&variables=${encodeURIComponent(variables)}`;

    const response = await gotScraping({
      url: graphqlUrl,
      headers: {
        'x-ig-app-id': IG_APP_ID,
        'User-Agent': DESKTOP_UA,
        'Referer': `https://www.instagram.com/${username}/`,
        ...(process.env.INSTAGRAM_SESSION_ID ? { 'Cookie': `sessionid=${process.env.INSTAGRAM_SESSION_ID.trim()}` } : {}),
      },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 126 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
      timeout: { request: 15000 },
    });

    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode} from GraphQL`);
    }

    const json = JSON.parse(response.body);
    const edges = json?.data?.user?.edge_owner_to_timeline_media?.edges || [];
    return edges.slice(0, limit).map((edge: any) => InstagramScraperService.parseGraphEdge(edge.node, username));
  }

  /**
   * Strategy 3: Instagram Mobile API
   */
  private static async viaMobileAPI(username: string, limit: number): Promise<ScrapedMedia[]> {
    // First get user ID via mobile endpoint
    const userResponse = await gotScraping({
      url: `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      headers: {
        'x-ig-app-id': IG_APP_ID,
        'User-Agent': MOBILE_UA,
        ...(process.env.INSTAGRAM_SESSION_ID ? { 'Cookie': `sessionid=${process.env.INSTAGRAM_SESSION_ID.trim()}` } : {}),
      },
      timeout: { request: 15000 },
    });

    if (userResponse.statusCode !== 200) {
      throw new Error(`HTTP ${userResponse.statusCode} from mobile API`);
    }

    const userData = JSON.parse(userResponse.body);
    const userId = userData?.data?.user?.id;
    if (!userId) {
      throw new Error('Could not find user ID via mobile');
    }

    // Get user feed from mobile API
    const feedResponse = await gotScraping({
      url: `https://i.instagram.com/api/v1/feed/user/${userId}/?count=${limit}`,
      headers: {
        'x-ig-app-id': IG_APP_ID,
        'User-Agent': MOBILE_UA,
        ...(process.env.INSTAGRAM_SESSION_ID ? { 'Cookie': `sessionid=${process.env.INSTAGRAM_SESSION_ID.trim()}` } : {}),
      },
      timeout: { request: 15000 },
    });

    if (feedResponse.statusCode !== 200) {
      throw new Error(`HTTP ${feedResponse.statusCode} from mobile feed`);
    }

    const feedData = JSON.parse(feedResponse.body);
    const items = feedData?.items || [];

    return items.slice(0, limit).map((item: any) => InstagramScraperService.parseMobileItem(item, username));
  }

  /**
   * Strategy 4: Instagram Embed endpoint (works without authentication)
   */
  private static async viaEmbed(username: string): Promise<ScrapedMedia[]> {
    const url = `https://www.instagram.com/${username}/?__a=1&__d=dis`;

    const response = await gotScraping({
      url,
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(process.env.INSTAGRAM_SESSION_ID ? { 'Cookie': `sessionid=${process.env.INSTAGRAM_SESSION_ID.trim()}` } : {}),
      },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 126 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
      timeout: { request: 15000 },
      retry: { limit: 2 },
    });

    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode} from __a=1 endpoint`);
    }

    const data = JSON.parse(response.body);
    const user = data?.graphql?.user || data?.data?.user;
    if (!user) {
      throw new Error('No user data in __a=1 response');
    }

    const edges = user?.edge_owner_to_timeline_media?.edges || [];
    return edges.map((edge: any) => InstagramScraperService.parseGraphEdge(edge.node, username));
  }

  /**
   * Parse a GraphQL edge node into our standard format
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

  /**
   * Parse a Mobile API feed item into our standard format
   */
  private static parseMobileItem(item: any, username: string): ScrapedMedia {
    let mediaType = 'IMAGE';
    if (item.media_type === 2 || item.product_type === 'clips') {
      mediaType = 'VIDEO';
    } else if (item.media_type === 8) {
      mediaType = 'CAROUSEL_ALBUM';
    }

    const shortcode = item.code || '';
    const timestamp = item.taken_at
      ? new Date(item.taken_at * 1000).toISOString()
      : new Date().toISOString();

    // For videos, get the best video URL
    let mediaUrl = '';
    if (item.video_versions && item.video_versions.length > 0) {
      mediaUrl = item.video_versions[0].url;
    } else if (item.image_versions2?.candidates?.[0]) {
      mediaUrl = item.image_versions2.candidates[0].url;
    }

    const thumbnailUrl = item.image_versions2?.candidates?.[0]?.url || '';

    return {
      id: item.pk?.toString() || item.id || shortcode,
      media_type: mediaType,
      media_url: mediaUrl,
      caption: item.caption?.text || '',
      timestamp,
      thumbnail_url: thumbnailUrl,
      shortcode,
      permalink: `https://www.instagram.com/p/${shortcode}/`,
    };
  }
}
