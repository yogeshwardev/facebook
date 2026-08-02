import { logger } from '../utils/logger';

async function fetchWithGotScraping(options: any) {
  const { gotScraping } = await (eval('import("got-scraping")') as Promise<any>);
  return gotScraping(options);
}

interface ScrapedPost {
  id: string;
  media_type: string;
  media_url: string;
  caption: string;
  timestamp: string;
  thumbnailUrl?: string;
}

const IG_APP_ID = '936619743392459';

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class InstagramScraperService {

  /**
   * Main entry: scrape a public Instagram profile for video reels.
   * Uses got-scraping to impersonate a real Chrome browser TLS fingerprint.
   */
  static async scrapeProfile(username: string, limit: number = 20): Promise<ScrapedPost[]> {
    const clean = username.replace(/^@+/, '').trim();
    logger.info(`[Scraper] Starting scrape for @${clean}`);

    // Strategy 1: Profile page HTML → extract embedded JSON
    try {
      const posts = await this.scrapeProfilePage(clean, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] Profile page returned ${posts.length} videos for @${clean}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Profile page failed for @${clean}: ${err.message}`);
    }

    await randomDelay(1500, 3000);

    // Strategy 2: Web Profile Info API
    try {
      const posts = await this.scrapeWebApi(clean, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] Web API returned ${posts.length} videos for @${clean}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Web API failed for @${clean}: ${err.message}`);
    }

    await randomDelay(1500, 3000);

    // Strategy 3: GraphQL query
    try {
      const posts = await this.scrapeGraphQL(clean, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] GraphQL returned ${posts.length} videos for @${clean}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] GraphQL failed for @${clean}: ${err.message}`);
    }

    logger.warn(`[Scraper] All strategies failed for @${clean}`);
    return [];
  }

  /**
   * Strategy 1: Fetch the profile page HTML and extract embedded JSON data.
   * Instagram embeds post data inside <script> tags on the profile page.
   */
  private static async scrapeProfilePage(username: string, limit: number): Promise<ScrapedPost[]> {
    const response = await fetchWithGotScraping({
      url: `https://www.instagram.com/${username}/`,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
    });

    const html = response.body;

    // Check for login wall / private account
    if (html.includes('"is_private":true')) {
      logger.warn(`[Scraper] @${username} is a private account`);
      return [];
    }

    const posts: ScrapedPost[] = [];

    // Method 1: Extract from window._sharedData
    const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});\s*<\/script>/s);
    if (sharedDataMatch) {
      try {
        const data = JSON.parse(sharedDataMatch[1]);
        const user = data?.entry_data?.ProfilePage?.[0]?.graphql?.user;
        if (user) {
          this.extractFromEdges(user.edge_owner_to_timeline_media?.edges, posts, limit);
          this.extractFromEdges(user.edge_felix_video_timeline?.edges, posts, limit);
        }
      } catch { /* ignore parse errors */ }
    }

    // Method 2: Extract from __additionalDataLoaded
    const additionalMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\s*\);\s*<\/script>/s);
    if (additionalMatch && posts.length === 0) {
      try {
        const data = JSON.parse(additionalMatch[1]);
        const user = data?.graphql?.user || data?.user;
        if (user) {
          this.extractFromEdges(user.edge_owner_to_timeline_media?.edges, posts, limit);
          this.extractFromEdges(user.edge_felix_video_timeline?.edges, posts, limit);
        }
      } catch { /* ignore */ }
    }

    // Method 3: Search all JSON script tags for media data
    if (posts.length === 0) {
      const scriptMatches = html.matchAll(/<script[^>]*type="application\/json"[^>]*>({.+?})<\/script>/gs);
      for (const match of scriptMatches) {
        try {
          const json = JSON.parse(match[1]);
          this.deepExtractVideos(json, posts, limit, 0);
          if (posts.length > 0) break;
        } catch { continue; }
      }
    }

    return posts.slice(0, limit);
  }

  /**
   * Strategy 2: Hit Instagram's web profile info API with Chrome TLS fingerprint.
   */
  private static async scrapeWebApi(username: string, limit: number): Promise<ScrapedPost[]> {
    const response = await fetchWithGotScraping({
      url: `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
      headers: {
        'X-IG-App-ID': IG_APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `https://www.instagram.com/${username}/`,
      },
    });

    const json = JSON.parse(response.body);
    const user = json?.data?.user;
    if (!user) return [];

    if (user.is_private) {
      logger.warn(`[Scraper] @${username} is a private account`);
      return [];
    }

    const posts: ScrapedPost[] = [];
    this.extractFromEdges(user.edge_owner_to_timeline_media?.edges, posts, limit);
    this.extractFromEdges(user.edge_felix_video_timeline?.edges, posts, limit);

    // For videos that don't have video_url in the listing, fetch individually
    const postsNeedingUrl = posts.filter(p => !p.media_url);
    for (const post of postsNeedingUrl) {
      try {
        await randomDelay(500, 1500);
        const videoUrl = await this.fetchVideoUrlByShortcode(post.id);
        if (videoUrl) post.media_url = videoUrl;
      } catch { /* skip */ }
    }

    return posts.filter(p => p.media_url).slice(0, limit);
  }

  /**
   * Strategy 3: Use Instagram's GraphQL endpoint directly.
   */
  private static async scrapeGraphQL(username: string, limit: number): Promise<ScrapedPost[]> {
    // First get user ID from the profile page
    const userId = await this.getUserId(username);
    if (!userId) return [];

    const variables = JSON.stringify({
      id: userId,
      first: limit,
    });

    // Try multiple known doc_ids (Instagram rotates these)
    const docIds = [
      '17991233890457762',  // edge_owner_to_timeline_media
      '17882528862075169',  // user media
    ];

    const posts: ScrapedPost[] = [];

    for (const docId of docIds) {
      if (posts.length > 0) break;
      try {
        const response = await fetchWithGotScraping({
          url: `https://www.instagram.com/graphql/query/?query_hash=${docId}&variables=${encodeURIComponent(variables)}`,
          headerGeneratorOptions: {
            browsers: [{ name: 'chrome', minVersion: 120 }],
            devices: ['desktop'],
            operatingSystems: ['windows'],
          },
          headers: {
            'X-IG-App-ID': IG_APP_ID,
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `https://www.instagram.com/${username}/`,
          },
        });

        const json = JSON.parse(response.body);
        const edges = json?.data?.user?.edge_owner_to_timeline_media?.edges;
        this.extractFromEdges(edges, posts, limit);
      } catch { continue; }
    }

    return posts.slice(0, limit);
  }

  /**
   * Get user ID by scraping the profile page.
   */
  private static async getUserId(username: string): Promise<string | null> {
    try {
      const response = await fetchWithGotScraping({
        url: `https://www.instagram.com/${username}/`,
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 120 }],
          devices: ['desktop'],
          operatingSystems: ['windows'],
        },
      });

      const html = response.body;

      // Try multiple patterns to find user ID
      const patterns = [
        /"profilePage_(\d+)"/,
        /"user_id":"(\d+)"/,
        /"owner":\s*{\s*"id":\s*"(\d+)"/,
        /instagram:\/\/user\?username=\w+&uid=(\d+)/,
        /"pk":"(\d+)"/,
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) return match[1];
      }
    } catch { /* ignore */ }
    return null;
  }

  /**
   * Fetch video URL for a specific post by its shortcode.
   */
  private static async fetchVideoUrlByShortcode(shortcode: string): Promise<string | null> {
    try {
      const response = await fetchWithGotScraping({
        url: `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
        headerGeneratorOptions: {
          browsers: [{ name: 'chrome', minVersion: 120 }],
          devices: ['desktop'],
          operatingSystems: ['windows'],
        },
        headers: {
          'X-IG-App-ID': IG_APP_ID,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      const json = JSON.parse(response.body);
      const item = json?.items?.[0] || json?.graphql?.shortcode_media;
      return item?.video_url || item?.video_versions?.[0]?.url || null;
    } catch {
      return null;
    }
  }

  /**
   * Extract posts (videos, images, carousels) from Instagram edge arrays (GraphQL format).
   */
  private static extractFromEdges(edges: any[] | undefined, posts: ScrapedPost[], limit: number): void {
    if (!edges || !Array.isArray(edges)) return;

    for (const edge of edges) {
      if (posts.length >= limit) return;
      const node = edge?.node || edge;
      if (!node) continue;

      const isVideo = Boolean(node.is_video || node.media_type === 2 || node.product_type === 'clips');
      const mediaType = isVideo ? 'VIDEO' : (node.is_carousel || node.media_type === 8 ? 'CAROUSEL_ALBUM' : 'IMAGE');
      
      const mediaUrl = isVideo 
        ? (node.video_url || node.video_versions?.[0]?.url || '')
        : (node.display_url || node.display_resources?.slice(-1)[0]?.src || node.thumbnail_src || node.image_versions2?.candidates?.[0]?.url || '');

      const id = node.id || String(node.pk) || node.shortcode;
      if (!id) continue;

      // Skip duplicates
      if (posts.find(p => p.id === id)) continue;

      posts.push({
        id,
        media_type: mediaType,
        media_url: mediaUrl,
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
      });
    }
  }

  /**
   * Recursively search a JSON object for post data.
   */
  private static deepExtractVideos(json: any, posts: ScrapedPost[], limit: number, depth: number): void {
    if (depth > 6 || !json || typeof json !== 'object' || posts.length >= limit) return;

    // Check for edge arrays
    const edgeKeys = [
      'edge_owner_to_timeline_media',
      'edge_felix_video_timeline',
      'xdt_api__v1__feed__user_timeline_graphql_connection',
    ];

    for (const key of edgeKeys) {
      if (json[key]?.edges) {
        this.extractFromEdges(json[key].edges, posts, limit);
        if (posts.length > 0) return;
      }
    }

    // Check for items array (v1 API format)
    if (Array.isArray(json.items)) {
      for (const item of json.items) {
        if (posts.length >= limit) return;
        
        const isVideo = item.media_type === 2 || item.product_type === 'clips';
        const mediaType = isVideo ? 'VIDEO' : (item.media_type === 8 ? 'CAROUSEL_ALBUM' : 'IMAGE');
        const mediaUrl = isVideo
          ? (item.video_versions?.[0]?.url || item.video_url || '')
          : (item.image_versions2?.candidates?.[0]?.url || item.display_url || '');

        if (!mediaUrl) continue;

        const id = item.id || String(item.pk);
        if (posts.find(p => p.id === id)) continue;

        posts.push({
          id,
          media_type: mediaType,
          media_url: mediaUrl,
          caption: item.caption?.text || '',
          timestamp: item.taken_at
            ? new Date(item.taken_at * 1000).toISOString()
            : new Date().toISOString(),
          thumbnailUrl: item.image_versions2?.candidates?.[0]?.url || item.display_url,
        });
      }
      if (posts.length > 0) return;
    }

    // Recurse into child objects
    for (const key of Object.keys(json)) {
      if (typeof json[key] === 'object') {
        this.deepExtractVideos(json[key], posts, limit, depth + 1);
        if (posts.length >= limit) return;
      }
    }
  }
}
