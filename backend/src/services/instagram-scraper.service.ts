import { ApifyClient } from 'apify-client';
import { logger } from '../utils/logger';

export type InstagramProvider = 'meta' | 'apify';

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
  public static isConfigured(): boolean {
    return Boolean(process.env.APIFY_TOKEN);
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

  private static normalizeMediaType(rawType: string | undefined, item: any): ScrapedMedia['media_type'] {
    const value = String(rawType || item.type || item.productType || '').toLowerCase();
    if (value.includes('carousel') || value.includes('sidecar') || item.childPosts?.length > 0) {
      return 'CAROUSEL_ALBUM';
    }
    if (value.includes('video') || value.includes('clips') || item.videoUrl) {
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
}
