import { ApifyClient } from 'apify-client';
import axios from 'axios';
import { logger } from '../utils/logger';
import { BrowserManager } from './browser-manager.service';

export type InstagramProvider = 'meta' | 'web' | 'browser' | 'apify';

export interface ScrapedMedia {
  id: string;
  media_type: 'VIDEO' | 'IMAGE' | 'CAROUSEL_ALBUM';
  media_url: string;
  caption: string;
  timestamp: string;
  thumbnail_url: string;
  shortcode: string;
  permalink: string;
  provider: InstagramProvider;
}

export class InstagramScraperService {
  private static readonly WEB_APP_ID = '936619743392459';

  public static isConfigured(): boolean {
    return Boolean(process.env.APIFY_TOKEN);
  }

  public static async scrapePublicWebProfile(username: string, limit = 24): Promise<ScrapedMedia[]> {
    const cleanUser = InstagramScraperService.cleanUsername(username);
    const headers = InstagramScraperService.webHeaders(cleanUser);
    const attempts = [
      {
        label: 'web_profile_info',
        url: 'https://www.instagram.com/api/v1/users/web_profile_info/',
        params: { username: cleanUser },
      },
      {
        label: '__a profile JSON',
        url: `https://www.instagram.com/${cleanUser}/`,
        params: { __a: 1, __d: 'dis' },
      },
    ];

    let lastError: Error | null = null;
    for (const attempt of attempts) {
      try {
        logger.info(`[Web] Loading Instagram ${attempt.label} for @${cleanUser}`);
        const response = await axios.get(attempt.url, {
          params: attempt.params,
          timeout: 20000,
          headers,
          validateStatus: status => status >= 200 && status < 500,
        });

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}`);
        }

        const user = response.data?.data?.user || response.data?.graphql?.user;
        if (!user) {
          throw new Error('response did not include user data');
        }

        const edges = user.edge_owner_to_timeline_media?.edges || [];
        return edges
          .slice(0, limit)
          .map((edge: any) => InstagramScraperService.parseWebEdge(edge.node))
          .filter((item: ScrapedMedia | null): item is ScrapedMedia => Boolean(item));
      } catch (err: any) {
        lastError = err;
        logger.warn(`[Web] Instagram ${attempt.label} failed for @${cleanUser}: ${err.message}`);
      }
    }

    throw lastError || new Error('Instagram public web profile request failed');
  }

  public static async scrapeProfile(username: string, limit = 24): Promise<ScrapedMedia[]> {
    const cleanUser = InstagramScraperService.cleanUsername(username);
    if (!process.env.APIFY_TOKEN) {
      throw new Error('APIFY_TOKEN is not configured. Add it to enable public Instagram feed imports.');
    }

    const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
    const input = {
      directUrls: [`https://www.instagram.com/${cleanUser}/`],
      resultsType: 'posts',
      resultsLimit: limit,
      searchType: 'user',
    };

    logger.info(`[Apify] Loading Instagram feed for @${cleanUser}`);
    const run = await client.actor('apify/instagram-scraper').call(input, {
      timeout: 180,
      waitForFinishSecs: 180,
    } as any);

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    logger.info(`[Apify] Loaded ${items.length} raw Instagram items for @${cleanUser}`);

    return items
      .map((item: any) => InstagramScraperService.parseApifyItem(item))
      .filter((item): item is ScrapedMedia => Boolean(item));
  }

  public static async scrapeRenderedProfile(username: string, limit = 24): Promise<ScrapedMedia[]> {
    const cleanUser = InstagramScraperService.cleanUsername(username);
    const context = await BrowserManager.getInstance().createContext({ blockAssets: false });
    const page = await context.newPage();

    try {
      logger.info(`[Browser] Rendering Instagram profile for @${cleanUser}`);
      await page.goto(`https://www.instagram.com/${cleanUser}/`, {
        waitUntil: 'networkidle',
        timeout: 45000,
      });
      await page.waitForTimeout(3000);

      const renderedItems = await page.evaluate((maxItems) => {
        const html = document.documentElement.innerHTML;
        const paths = Array.from(
          new Set((html.match(/\/(?:p|reel|tv)\/[A-Za-z0-9_-]+/g) || []))
        ).slice(0, maxItems);

        const postImages = Array.from(document.querySelectorAll('img'))
          .map((img) => ({
            src: img.src,
            alt: img.alt || '',
          }))
          .filter((img) => /Photo by|Video by/i.test(img.alt));

        return paths.map((path, index) => {
          const image = postImages[index] || postImages.find((img) => html.indexOf(img.src) > -1);
          return {
            path,
            imageSrc: image?.src || '',
            alt: image?.alt || '',
          };
        });
      }, limit);

      return renderedItems
        .map((item: any) => InstagramScraperService.parseRenderedItem(item))
        .filter((item: ScrapedMedia | null): item is ScrapedMedia => Boolean(item));
    } finally {
      await context.close();
    }
  }

  public static cleanUsername(username: string): string {
    return username.replace(/^@+/, '').trim();
  }

  public static normalizeMetaMedia(item: any): ScrapedMedia | null {
    const id = String(item.id || item.shortcode || '').trim();
    if (!id) return null;

    const mediaType = InstagramScraperService.normalizeMediaType(item.media_type, item);
    const permalink = item.permalink || (item.shortcode ? `https://www.instagram.com/p/${item.shortcode}/` : '');

    return {
      id,
      media_type: mediaType,
      media_url: item.media_url || item.thumbnail_url || '',
      caption: item.caption || '',
      timestamp: InstagramScraperService.toIsoDate(item.timestamp),
      thumbnail_url: item.thumbnail_url || item.media_url || '',
      shortcode: item.shortcode || InstagramScraperService.shortcodeFromPermalink(permalink),
      permalink,
      provider: 'meta',
    };
  }

  private static parseApifyItem(item: any): ScrapedMedia | null {
    const shortcode = item.shortCode || item.shortcode || item.code || InstagramScraperService.shortcodeFromPermalink(item.url);
    const id = String(item.id || shortcode || '').trim();
    if (!id) return null;

    const mediaType = InstagramScraperService.normalizeMediaType(item.media_type, item);
    const mediaUrl = item.videoUrl || item.displayUrl || item.imageUrl || item.url || '';
    const thumbnailUrl = item.displayUrl || item.thumbnailUrl || item.imageUrl || mediaUrl;

    return {
      id,
      media_type: mediaType,
      media_url: mediaUrl,
      caption: item.caption || item.text || '',
      timestamp: InstagramScraperService.toIsoDate(item.timestamp),
      thumbnail_url: thumbnailUrl,
      shortcode,
      permalink: item.url || (shortcode ? `https://www.instagram.com/p/${shortcode}/` : ''),
      provider: 'apify',
    };
  }

  private static parseWebEdge(node: any): ScrapedMedia | null {
    const shortcode = node.shortcode || '';
    const id = String(node.id || shortcode || '').trim();
    if (!id) return null;

    const permalink = shortcode ? `https://www.instagram.com/p/${shortcode}/` : '';
    const thumbnailUrl = node.thumbnail_src || node.display_url || '';

    return {
      id,
      media_type: InstagramScraperService.normalizeMediaType(node.media_type, node),
      media_url: node.video_url || node.display_url || thumbnailUrl,
      caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
      timestamp: InstagramScraperService.toIsoDate(node.taken_at_timestamp),
      thumbnail_url: thumbnailUrl,
      shortcode,
      permalink,
      provider: 'web',
    };
  }

  private static parseRenderedItem(item: { path: string; imageSrc: string; alt: string }): ScrapedMedia | null {
    const match = item.path.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (!match) return null;

    const [, kind, shortcode] = match;
    const alt = item.alt || '';
    const isVideo = kind === 'reel' || /^Video by/i.test(alt);
    const timestamp = InstagramScraperService.dateFromAltText(alt);

    return {
      id: shortcode,
      media_type: isVideo ? 'VIDEO' : 'IMAGE',
      media_url: item.imageSrc,
      caption: alt,
      timestamp,
      thumbnail_url: item.imageSrc,
      shortcode,
      permalink: `https://www.instagram.com/${kind}/${shortcode}/`,
      provider: 'browser',
    };
  }

  private static webHeaders(username: string): Record<string, string> {
    return {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': `https://www.instagram.com/${username}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'X-IG-App-ID': InstagramScraperService.WEB_APP_ID,
      'X-Requested-With': 'XMLHttpRequest',
    };
  }

  private static normalizeMediaType(rawType: string | undefined, item: any): ScrapedMedia['media_type'] {
    const value = String(rawType || item.type || item.productType || item.__typename || '').toLowerCase();
    if (value.includes('carousel') || value.includes('sidecar') || item.childPosts?.length > 0 || item.edge_sidecar_to_children) {
      return 'CAROUSEL_ALBUM';
    }
    if (value.includes('video') || value.includes('clips') || item.videoUrl || item.is_video) {
      return 'VIDEO';
    }
    return 'IMAGE';
  }

  private static shortcodeFromPermalink(permalink?: string): string {
    if (!permalink) return '';
    const match = permalink.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
    return match?.[1] || '';
  }

  private static toIsoDate(value: string | number | undefined): string {
    if (!value) return new Date().toISOString();
    const date = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  private static dateFromAltText(value: string): string {
    const match = value.match(/\bon ([A-Z][a-z]+ \d{1,2}, \d{4})\b/);
    if (!match) return new Date().toISOString();

    const date = new Date(match[1]);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
}
