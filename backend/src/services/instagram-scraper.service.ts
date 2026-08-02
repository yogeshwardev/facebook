import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

interface ScrapedPost {
  id: string;
  media_type: string;
  media_url: string;
  caption: string;
  timestamp: string;
  thumbnailUrl?: string;
}

// Instagram's internal app ID (used by the web client)
const IG_APP_ID = '936619743392459';

// Rotate user agents to avoid fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class InstagramScraperService {

  /**
   * Create an axios instance with stealth headers that mimic a real browser.
   */
  private static createClient(): AxiosInstance {
    return axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.instagram.com/',
        'X-IG-App-ID': IG_APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
      },
    });
  }

  /**
   * Main entry point: Scrape Instagram posts/reels from a public profile.
   * Uses multiple strategies in order:
   * 1. Instagram's private web API (fastest, most data)
   * 2. Public page HTML parsing (embedded JSON)
   * 3. Instagram's i.instagram.com mobile API
   */
  static async scrapeProfile(username: string, limit: number = 20): Promise<ScrapedPost[]> {
    const cleanUsername = username.replace(/^@+/, '').trim();
    logger.info(`[Scraper] Starting scrape for @${cleanUsername}`);

    // Strategy 1: Try the web profile info API
    try {
      const posts = await this.tryWebProfileApi(cleanUsername, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] Web API returned ${posts.length} videos for @${cleanUsername}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Web API failed for @${cleanUsername}: ${err.message}`);
    }

    await randomDelay(1000, 2000);

    // Strategy 2: Try parsing the public profile page HTML
    try {
      const posts = await this.tryPublicPageParse(cleanUsername, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] HTML parse returned ${posts.length} videos for @${cleanUsername}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] HTML parse failed for @${cleanUsername}: ${err.message}`);
    }

    await randomDelay(1000, 2000);

    // Strategy 3: Try the mobile API
    try {
      const posts = await this.tryMobileApi(cleanUsername, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] Mobile API returned ${posts.length} videos for @${cleanUsername}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Mobile API failed for @${cleanUsername}: ${err.message}`);
    }

    logger.warn(`[Scraper] All strategies failed for @${cleanUsername}`);
    return [];
  }

  /**
   * Strategy 1: Use Instagram's web profile info API.
   * This endpoint returns JSON with all the user's posts.
   */
  private static async tryWebProfileApi(username: string, limit: number): Promise<ScrapedPost[]> {
    const client = this.createClient();
    const posts: ScrapedPost[] = [];

    // First, get the web profile info (contains user ID and recent posts)
    const res = await client.get(
      `https://www.instagram.com/api/v1/users/web_profile_info/`,
      { params: { username } }
    );

    const user = res.data?.data?.user;
    if (!user) {
      throw new Error('User not found or private');
    }

    // Extract posts from edge_owner_to_timeline_media
    const edges = user.edge_owner_to_timeline_media?.edges || [];
    for (const edge of edges) {
      const node = edge.node;
      if (!node || !node.is_video) continue;

      let videoUrl = node.video_url || '';

      // If no video_url in the listing, fetch individual post
      if (!videoUrl && node.shortcode) {
        try {
          await randomDelay(300, 800);
          videoUrl = await this.fetchPostVideoUrl(client, node.shortcode);
        } catch {
          // Skip this post
          continue;
        }
      }

      if (videoUrl) {
        posts.push({
          id: node.id || String(node.pk),
          media_type: 'VIDEO',
          media_url: videoUrl,
          caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
          timestamp: node.taken_at_timestamp
            ? new Date(node.taken_at_timestamp * 1000).toISOString()
            : new Date().toISOString(),
          thumbnailUrl: node.display_url || node.thumbnail_src,
        });
      }

      if (posts.length >= limit) break;
    }

    // Also check edge_felix_video_timeline (dedicated reels/IGTV)
    const reelEdges = user.edge_felix_video_timeline?.edges || [];
    for (const edge of reelEdges) {
      const node = edge.node;
      if (!node) continue;
      // Skip if already added
      if (posts.find(p => p.id === node.id)) continue;

      let videoUrl = node.video_url || '';
      if (!videoUrl && node.shortcode) {
        try {
          await randomDelay(300, 800);
          videoUrl = await this.fetchPostVideoUrl(client, node.shortcode);
        } catch {
          continue;
        }
      }

      if (videoUrl) {
        posts.push({
          id: node.id || String(node.pk),
          media_type: 'VIDEO',
          media_url: videoUrl,
          caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
          timestamp: node.taken_at_timestamp
            ? new Date(node.taken_at_timestamp * 1000).toISOString()
            : new Date().toISOString(),
          thumbnailUrl: node.display_url || node.thumbnail_src,
        });
      }

      if (posts.length >= limit) break;
    }

    return posts;
  }

  /**
   * Fetch the video URL for a specific post by shortcode.
   */
  private static async fetchPostVideoUrl(client: AxiosInstance, shortcode: string): Promise<string> {
    const res = await client.get(
      `https://www.instagram.com/p/${shortcode}/`,
      {
        params: { __a: 1, __d: 'dis' },
        headers: { ...client.defaults.headers.common as any },
      }
    );

    const item = res.data?.items?.[0] || res.data?.graphql?.shortcode_media;
    return item?.video_url || item?.video_versions?.[0]?.url || '';
  }

  /**
   * Strategy 2: Parse the public Instagram profile page HTML.
   * Instagram embeds JSON data in script tags on the page.
   */
  private static async tryPublicPageParse(username: string, limit: number): Promise<ScrapedPost[]> {
    const client = this.createClient();
    const posts: ScrapedPost[] = [];

    const res = await client.get(`https://www.instagram.com/${username}/`, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
    });

    const html: string = res.data;

    // Try to find embedded JSON data in script tags
    const patterns = [
      /window\._sharedData\s*=\s*({.+?});<\/script>/s,
      /window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\s*\);<\/script>/s,
      /<script\s+type="application\/json"\s+data-content-len="\d+"\s+data-sjs>({.+?})<\/script>/gs,
    ];

    for (const pattern of patterns) {
      const matches = html.matchAll(pattern);
      for (const match of matches) {
        try {
          const json = JSON.parse(match[1]);
          const extracted = this.extractVideosFromJson(json, limit);
          posts.push(...extracted);
          if (posts.length > 0) return posts.slice(0, limit);
        } catch {
          continue;
        }
      }
    }

    return posts;
  }

  /**
   * Strategy 3: Use Instagram's mobile API (i.instagram.com).
   */
  private static async tryMobileApi(username: string, limit: number): Promise<ScrapedPost[]> {
    const posts: ScrapedPost[] = [];

    const mobileClient = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': 'Instagram 317.0.0.34.109 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 562425185)',
        'Accept': '*/*',
        'Accept-Language': 'en-US',
        'X-IG-App-ID': '567067343352427', // Android app ID
      },
    });

    try {
      // Get user ID first
      const searchRes = await mobileClient.get(
        `https://i.instagram.com/api/v1/users/web_profile_info/`,
        { params: { username } }
      );

      const userId = searchRes.data?.data?.user?.id;
      if (!userId) throw new Error('User ID not found');

      // Get user feed
      const feedRes = await mobileClient.get(
        `https://i.instagram.com/api/v1/feed/user/${userId}/`,
        { params: { count: limit } }
      );

      const items = feedRes.data?.items || [];
      for (const item of items) {
        if (item.media_type !== 2 && item.product_type !== 'clips') continue;

        const videoUrl = item.video_versions?.[0]?.url || '';
        if (!videoUrl) continue;

        posts.push({
          id: item.id || String(item.pk),
          media_type: 'VIDEO',
          media_url: videoUrl,
          caption: item.caption?.text || '',
          timestamp: item.taken_at
            ? new Date(item.taken_at * 1000).toISOString()
            : new Date().toISOString(),
          thumbnailUrl: item.image_versions2?.candidates?.[0]?.url,
        });

        if (posts.length >= limit) break;
      }
    } catch (err: any) {
      throw new Error(`Mobile API error: ${err.message}`);
    }

    return posts;
  }

  /**
   * Recursively search a JSON object for video post data.
   */
  private static extractVideosFromJson(json: any, limit: number, depth: number = 0): ScrapedPost[] {
    const posts: ScrapedPost[] = [];
    if (depth > 8 || !json || typeof json !== 'object') return posts;

    // Check for known edge arrays
    const edgeKeys = [
      'edge_owner_to_timeline_media',
      'edge_felix_video_timeline',
      'xdt_api__v1__feed__user_timeline_graphql_connection',
    ];

    for (const key of edgeKeys) {
      if (json[key]?.edges) {
        for (const edge of json[key].edges) {
          const node = edge.node;
          if (!node || !node.is_video) continue;

          posts.push({
            id: node.id || String(node.pk),
            media_type: 'VIDEO',
            media_url: node.video_url || '',
            caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
            timestamp: node.taken_at_timestamp
              ? new Date(node.taken_at_timestamp * 1000).toISOString()
              : new Date().toISOString(),
            thumbnailUrl: node.display_url || node.thumbnail_src,
          });

          if (posts.length >= limit) return posts;
        }
      }
    }

    // Check for items array (mobile API format)
    if (Array.isArray(json.items)) {
      for (const item of json.items) {
        if (item.media_type !== 2 && item.product_type !== 'clips') continue;
        const videoUrl = item.video_versions?.[0]?.url || item.video_url || '';
        if (!videoUrl) continue;

        posts.push({
          id: item.id || String(item.pk),
          media_type: 'VIDEO',
          media_url: videoUrl,
          caption: item.caption?.text || '',
          timestamp: item.taken_at
            ? new Date(item.taken_at * 1000).toISOString()
            : new Date().toISOString(),
          thumbnailUrl: item.image_versions2?.candidates?.[0]?.url,
        });

        if (posts.length >= limit) return posts;
      }
    }

    // Recurse into child objects
    if (posts.length === 0) {
      for (const key of Object.keys(json)) {
        if (typeof json[key] === 'object') {
          const found = this.extractVideosFromJson(json[key], limit, depth + 1);
          posts.push(...found);
          if (posts.length >= limit) return posts.slice(0, limit);
        }
      }
    }

    return posts;
  }
}
