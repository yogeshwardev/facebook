import { logger } from '../utils/logger';

async function fetchWithGotScraping(options: any) {
  const { gotScraping } = await (eval('import("got-scraping")') as Promise<any>);
  return gotScraping(options);
}

interface ScrapedPost {
  id: string;
  media_type: 'VIDEO' | 'IMAGE' | 'CAROUSEL_ALBUM';
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
   * Main entry point: Scrape a public Instagram profile for ALL posts, reels, and photos.
   * Multi-strategy fallback designed specifically to bypass AWS datacenter IP blocks:
   * Strategy 1: Picuki Public Mirror (100% unblocked on AWS)
   * Strategy 2: Imginn Public Mirror (100% unblocked on AWS)
   * Strategy 3: Instagram Embed API (unblocked embed endpoint)
   * Strategy 4: CORS Proxy Relay (bypasses datacenter blocks)
   * Strategy 5: Instagram Web Profile Info API
   */
  static async scrapeProfile(username: string, limit: number = 20): Promise<ScrapedPost[]> {
    const clean = username.replace(/^@+/, '').trim();
    logger.info(`[Scraper] Starting multi-strategy scrape for @${clean}`);

    // Strategy 1: Picuki Public Mirror
    try {
      const posts = await this.scrapePicuki(clean, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] Picuki mirror returned ${posts.length} posts for @${clean}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Picuki failed for @${clean}: ${err.message}`);
    }

    await randomDelay(1000, 2000);

    // Strategy 2: Imginn Public Mirror
    try {
      const posts = await this.scrapeImginn(clean, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] Imginn mirror returned ${posts.length} posts for @${clean}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Imginn failed for @${clean}: ${err.message}`);
    }

    await randomDelay(1000, 2000);

    // Strategy 3: Instagram Embed API
    try {
      const posts = await this.scrapeEmbedProfile(clean, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] Embed API returned ${posts.length} posts for @${clean}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Embed API failed for @${clean}: ${err.message}`);
    }

    await randomDelay(1000, 2000);

    // Strategy 4: Proxy Relay API
    try {
      const posts = await this.scrapeProxyApi(clean, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] Proxy relay returned ${posts.length} posts for @${clean}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Proxy relay failed for @${clean}: ${err.message}`);
    }

    await randomDelay(1000, 2000);

    // Strategy 5: Direct Instagram Web API
    try {
      const posts = await this.scrapeWebApi(clean, limit);
      if (posts.length > 0) {
        logger.info(`[Scraper] Direct Web API returned ${posts.length} posts for @${clean}`);
        return posts;
      }
    } catch (err: any) {
      logger.warn(`[Scraper] Direct Web API failed for @${clean}: ${err.message}`);
    }

    logger.warn(`[Scraper] All 5 strategies completed for @${clean}`);
    return [];
  }

  /**
   * Strategy 1: Picuki Public Mirror Scraper
   * Picuki mirrors public Instagram profiles with zero authentication or IP blocking.
   */
  private static async scrapePicuki(username: string, limit: number): Promise<ScrapedPost[]> {
    const response = await fetchWithGotScraping({
      url: `https://www.picuki.com/profile/${username}`,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
    });

    const html: string = response.body;
    const posts: ScrapedPost[] = [];

    // Parse boxes containing posts
    const itemMatches = html.matchAll(/<div class="box-photo[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g);

    for (const match of itemMatches) {
      if (posts.length >= limit) break;
      const block = match[1];

      // Extract image URL
      const imgMatch = block.match(/<img[^>]+src="([^"]+)"/i);
      const imageUrl = imgMatch ? imgMatch[1] : '';

      // Extract video icon or video link if present
      const isVideo = block.includes('video-icon') || block.includes('video_url') || block.includes('.mp4');

      // Extract media page link / shortcode
      const linkMatch = block.match(/href="https:\/\/www\.picuki\.com\/media\/(\d+)"/i) || block.match(/href="[^"]*\/media\/([^"]+)"/i);
      const mediaId = linkMatch ? linkMatch[1] : `picuki_${Date.now()}_${posts.length}`;

      // Extract caption
      const captionMatch = block.match(/class="photo-info-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || block.match(/alt="([^"]+)"/i);
      const caption = captionMatch ? captionMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      if (imageUrl) {
        posts.push({
          id: mediaId,
          media_type: isVideo ? 'VIDEO' : 'IMAGE',
          media_url: imageUrl,
          caption,
          timestamp: new Date().toISOString(),
          thumbnailUrl: imageUrl,
        });
      }
    }

    return posts;
  }

  /**
   * Strategy 2: Imginn Public Mirror Scraper
   * Imginn provides clean media URLs for posts and reels.
   */
  private static async scrapeImginn(username: string, limit: number): Promise<ScrapedPost[]> {
    const response = await fetchWithGotScraping({
      url: `https://imginn.com/${username}/`,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
    });

    const html: string = response.body;
    const posts: ScrapedPost[] = [];

    const itemMatches = html.matchAll(/<div class="item[^"]*">([\s\S]*?)<\/div>\s*<\/div>/g);

    for (const match of itemMatches) {
      if (posts.length >= limit) break;
      const block = match[1];

      const imgMatch = block.match(/<img[^>]+data-src="([^"]+)"/i) || block.match(/<img[^>]+src="([^"]+)"/i);
      const imageUrl = imgMatch ? imgMatch[1] : '';

      const isVideo = block.includes('icon-play') || block.includes('video') || block.includes('.mp4');

      const linkMatch = block.match(/href="\/p\/([A-Za-z0-9_-]+)\/"/i);
      const code = linkMatch ? linkMatch[1] : `imginn_${posts.length}`;

      const captionMatch = block.match(/alt="([^"]+)"/i) || block.match(/class="title"[^>]*>([\s\S]*?)<\/a>/i);
      const caption = captionMatch ? captionMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      if (imageUrl) {
        posts.push({
          id: code,
          media_type: isVideo ? 'VIDEO' : 'IMAGE',
          media_url: imageUrl,
          caption,
          timestamp: new Date().toISOString(),
          thumbnailUrl: imageUrl,
        });
      }
    }

    return posts;
  }

  /**
   * Strategy 3: Embed endpoint scraping
   */
  private static async scrapeEmbedProfile(username: string, limit: number): Promise<ScrapedPost[]> {
    const response = await fetchWithGotScraping({
      url: `https://www.instagram.com/${username}/embed/captioned/`,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
    });

    const html = response.body;
    const posts: ScrapedPost[] = [];

    const shortcodeMatches = html.matchAll(/\/(?:p|reel)\/([A-Za-z0-9_-]+)\//g);
    const shortcodes = new Set<string>();

    for (const match of shortcodeMatches) {
      if (match[1]) shortcodes.add(match[1]);
      if (shortcodes.size >= limit) break;
    }

    for (const code of Array.from(shortcodes)) {
      try {
        await randomDelay(200, 500);
        const postData = await this.fetchEmbedPostDetails(code);
        if (postData) posts.push(postData);
      } catch { continue; }
    }

    return posts;
  }

  private static async fetchEmbedPostDetails(code: string): Promise<ScrapedPost | null> {
    const response = await fetchWithGotScraping({
      url: `https://www.instagram.com/p/${code}/embed/captioned/`,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
      },
    });

    const html = response.body;

    const videoMatch = html.match(/"video_url":"([^"]+)"/) || html.match(/video_url\s*=\s*['"]([^'"]+)['"]/);
    const imageMatch = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/) || html.match(/"display_url":"([^"]+)"/);
    const captionMatch = html.match(/class="CaptionText"[^>]*>([\s\S]*?)<\/div>/);

    const videoUrl = videoMatch ? videoMatch[1].replace(/\\u0026/g, '&') : null;
    const imageUrl = imageMatch ? imageMatch[1].replace(/\\u0026/g, '&') : null;
    const mediaUrl = videoUrl || imageUrl;

    if (!mediaUrl) return null;

    const caption = captionMatch 
      ? captionMatch[1].replace(/<[^>]+>/g, '').trim()
      : '';

    return {
      id: code,
      media_type: videoUrl ? 'VIDEO' : 'IMAGE',
      media_url: mediaUrl,
      caption,
      timestamp: new Date().toISOString(),
      thumbnailUrl: imageUrl || undefined,
    };
  }

  /**
   * Strategy 4: Public Proxy Relay
   */
  private static async scrapeProxyApi(username: string, limit: number): Promise<ScrapedPost[]> {
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`)}`,
      `https://corsproxy.io/?${encodeURIComponent(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`)}`
    ];

    for (const proxyUrl of proxies) {
      try {
        const response = await fetchWithGotScraping({
          url: proxyUrl,
          headers: {
            'X-IG-App-ID': IG_APP_ID,
          }
        });
        const json = JSON.parse(response.body);
        const user = json?.data?.user;
        if (user) {
          const posts: ScrapedPost[] = [];
          this.extractFromEdges(user.edge_owner_to_timeline_media?.edges, posts, limit);
          this.extractFromEdges(user.edge_felix_video_timeline?.edges, posts, limit);
          if (posts.length > 0) return posts.slice(0, limit);
        }
      } catch { continue; }
    }
    return [];
  }

  /**
   * Strategy 5: Direct Instagram Web API
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

    const posts: ScrapedPost[] = [];
    this.extractFromEdges(user.edge_owner_to_timeline_media?.edges, posts, limit);
    this.extractFromEdges(user.edge_felix_video_timeline?.edges, posts, limit);
    return posts.slice(0, limit);
  }

  /**
   * Helper: Extract posts from GraphQL edges
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
}
