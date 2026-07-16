import { ApifyClient } from 'apify-client';
import { logger } from '../utils/logger';

// Ensure the token is provided in .env
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const client = APIFY_TOKEN ? new ApifyClient({ token: APIFY_TOKEN }) : null;

export class ApifyService {
  static async getInstagramReels(username: string, limit: number = 20) {
    if (!client) {
      throw new Error('APIFY_TOKEN is not configured');
    }

    try {
      logger.info(`Starting Apify scrape for @${username}`);
      
      const input = {
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: 'posts',
        resultsLimit: limit,
      };

      // Run the actor and wait for it to finish
      const run = await client.actor('apify/instagram-scraper').call(input);

      // Fetch the results from the dataset
      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      
      logger.info(`Apify scrape finished for @${username}, found ${items.length} items`);
      
      // Filter to only return reels (video)
      const videos = items.filter((item: any) => item.videoUrl || item.productType === 'clips');
      
      return videos.map((v: any) => ({
        id: v.id,
        media_type: 'VIDEO',
        media_url: v.videoUrl,
        caption: v.text || v.caption,
        timestamp: v.timestamp
      }));
    } catch (error) {
      logger.error({ error }, 'Apify scraper failed');
      throw error;
    }
  }
}
