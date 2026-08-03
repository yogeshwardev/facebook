import { InstagramScraperService } from './instagram-scraper.service';

export class ApifyService {
  static async getInstagramReels(username: string, limit: number = 20) {
    const items = await InstagramScraperService.scrapeProfile(username, limit);
    return items.filter(item => item.media_type === 'VIDEO');
  }
}
