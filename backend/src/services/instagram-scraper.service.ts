import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { env } from '../config/env';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ScrapedPost {
  id: string;
  media_type: 'VIDEO' | 'IMAGE' | 'CAROUSEL_ALBUM';
  media_url: string;
  thumbnail_url?: string;
  caption: string;
  timestamp: string;
  shortcode?: string;
  like_count?: number;
  play_count?: number;
  is_reel?: boolean;
}

interface CacheEntry {
  data: ScrapedPost[];
  expiresAt: number;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const IG_APP_ID = '936619743392459';
const IG_ASBD_ID = '198387';

/**
 * Realistic User-Agent pool — mix of desktop Chrome, mobile Safari (iOS), and Firefox.
 * Instagram often responds better to mobile UAs for the i.instagram.com host.
 */
const USER_AGENTS = [
  // Desktop Chrome (Windows)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  // Desktop Chrome (Mac)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  // Desktop Chrome (Linux)
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  // Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  // Safari macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  // iPhone Safari (Instagram responds well to mobile UAs for i.instagram.com)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.27.93',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 Instagram 331.0.3.29.87',
];

/**
 * Known working GraphQL query hashes. Instagram rotates these periodically.
 * Add new ones at the front when the old ones stop working.
 */
const GRAPHQL_QUERY_HASHES = [
  'e769aa130647d2354c40ea6a439bfc08', // profile media (2024-2025)
  '42323d64886122307be10013ad2dcc44', // alternate
  '003056d32c2554def87228bc3fd9668a', // older fallback
  'bfa387b2992c3a52dcbe447467b4b771', // reels tab
];

// ─────────────────────────────────────────────
// In-Memory Cache
// ─────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

function getCached(username: string): ScrapedPost[] | null {
  const entry = cache.get(username.toLowerCase());
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(username.toLowerCase());
    return null;
  }
  return entry.data;
}

function setCached(username: string, data: ScrapedPost[]): void {
  cache.set(username.toLowerCase(), {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ─────────────────────────────────────────────
// Session / CSRF Bootstrap
// ─────────────────────────────────────────────

interface Session {
  csrfToken: string;
  cookies: string;
  expiresAt: number;
}

let session: Session | null = null;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Bootstrap a session by hitting the Instagram homepage and extracting
 * the csrftoken cookie. This makes subsequent API calls look more legitimate
 * since they carry a real session cookie.
 *
 * If INSTAGRAM_SESSION_ID is set in env, it is appended to the cookies,
 * which authenticates the request and bypasses IP-based blocking.
 */
async function getSession(): Promise<Session> {
  if (session && Date.now() < session.expiresAt) return session;

  try {
    const ua = randomUA();
    const res = await axios.get('https://www.instagram.com/', {
      timeout: 15_000,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    const setCookieHeaders: string[] = Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie']
      : (res.headers['set-cookie'] ? [res.headers['set-cookie']] : []);

    const cookieParts: string[] = [];
    let csrfToken = '';

    for (const c of setCookieHeaders) {
      const part = c.split(';')[0].trim();
      cookieParts.push(part);
      const csrfMatch = c.match(/csrftoken=([^;]+)/);
      if (csrfMatch) csrfToken = csrfMatch[1];
    }

    if (!csrfToken) {
      const html: string = res.data || '';
      const match = html.match(/"csrf_token"\s*:\s*"([^"]+)"/);
      if (match) csrfToken = match[1];
    }

    // Inject real Instagram sessionid from environment if available
    const sessionId = env.INSTAGRAM_SESSION_ID;
    if (sessionId) {
      // Decode URL-encoded value if needed (browsers encode : as %3A)
      const decoded = decodeURIComponent(sessionId);
      // Remove any existing sessionid from cookies to avoid duplicates
      const filtered = cookieParts.filter(p => !p.startsWith('sessionid='));
      filtered.push(`sessionid=${decoded}`);
      const cookies = filtered.join('; ');
      session = { csrfToken, cookies, expiresAt: Date.now() + SESSION_TTL_MS };
      logger.info(`[Scraper] Session bootstrapped with real sessionid. csrfToken: ${csrfToken ? 'yes' : 'no'}`);
    } else {
      const cookies = cookieParts.join('; ');
      session = { csrfToken, cookies, expiresAt: Date.now() + SESSION_TTL_MS };
      logger.info(`[Scraper] Session bootstrapped (no sessionid). csrfToken: ${csrfToken ? 'yes' : 'no'}, cookies: ${cookieParts.length}`);
    }

    return session;
  } catch (err: any) {
    logger.warn(`[Scraper] Session bootstrap failed: ${err.message}`);

    // Fall back to just the sessionid if we have it
    const sessionId = env.INSTAGRAM_SESSION_ID;
    if (sessionId) {
      const decoded = decodeURIComponent(sessionId);
      session = {
        csrfToken: '',
        cookies: `sessionid=${decoded}`,
        expiresAt: Date.now() + SESSION_TTL_MS,
      };
      logger.info(`[Scraper] Using sessionid-only fallback session`);
      return session;
    }

    return { csrfToken: '', cookies: '', expiresAt: Date.now() + 30_000 };
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function delay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createClient(username: string): AxiosInstance {
  return axios.create({
    timeout: 20_000,
    headers: {
      'User-Agent': randomUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Referer': `https://www.instagram.com/${username}/`,
      'Origin': 'https://www.instagram.com',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Sec-CH-UA': '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="99"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'DNT': '1',
      'Upgrade-Insecure-Requests': '1',
    },
  });
}

// ─────────────────────────────────────────────
// Data extraction helpers
// ─────────────────────────────────────────────

function mediaTypeFromNode(node: any): ScrapedPost['media_type'] {
  if (node.media_type === 2 || node.is_video || node.product_type === 'clips') return 'VIDEO';
  if (node.media_type === 8 || node.__typename === 'GraphSidecar') return 'CAROUSEL_ALBUM';
  return 'IMAGE';
}

function extractFromEdges(
  edges: any[] | undefined,
  posts: ScrapedPost[],
  limit: number,
  videosOnly = false,
): void {
  if (!Array.isArray(edges)) return;

  for (const edge of edges) {
    if (posts.length >= limit) return;
    const node = edge?.node ?? edge;
    if (!node) continue;

    const type = mediaTypeFromNode(node);
    if (videosOnly && type !== 'VIDEO') continue;

    // Deduplicate by ID or shortcode
    const id = String(node.id || node.pk || node.shortcode || '');
    const shortcode = node.shortcode || node.code || '';
    if (id && posts.some(p => p.id === id)) continue;

    const videoUrl = node.video_url || node.video_versions?.[0]?.url || '';
    const imageUrl = node.display_url || node.thumbnail_src || node.image_versions2?.candidates?.[0]?.url || '';
    const media_url = type === 'VIDEO' ? videoUrl : imageUrl;

    const caption =
      node.edge_media_to_caption?.edges?.[0]?.node?.text ||
      node.caption?.text ||
      (typeof node.caption === 'string' ? node.caption : '') ||
      '';

    const ts = node.taken_at_timestamp ?? node.taken_at ?? null;
    const timestamp = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString();

    posts.push({
      id: id || shortcode,
      media_type: type,
      media_url,
      thumbnail_url: type === 'VIDEO' ? (node.thumbnail_src || node.display_url || imageUrl) : undefined,
      caption,
      timestamp,
      shortcode,
      like_count: node.edge_liked_by?.count ?? node.like_count ?? undefined,
      play_count: node.video_view_count ?? node.play_count ?? undefined,
      is_reel: node.product_type === 'clips' || node.is_reel || false,
    });
  }
}

function deepSearch(json: any, posts: ScrapedPost[], limit: number, depth = 0): void {
  if (depth > 8 || !json || typeof json !== 'object' || posts.length >= limit) return;

  const edgeKeys = [
    'edge_owner_to_timeline_media',
    'edge_felix_video_timeline',
    'edge_user_to_photos_of_you',
    'xdt_api__v1__feed__user_timeline_graphql_connection',
    'xdt_api__v1__clips__user__connection_v2',
  ];

  for (const key of edgeKeys) {
    if (json[key]?.edges?.length) {
      extractFromEdges(json[key].edges, posts, limit);
      if (posts.length > 0) return;
    }
  }

  // v1 items array format
  if (Array.isArray(json.items) && json.items.length) {
    extractFromEdges(json.items, posts, limit);
    if (posts.length > 0) return;
  }

  for (const key of Object.keys(json)) {
    if (typeof json[key] === 'object') {
      deepSearch(json[key], posts, limit, depth + 1);
      if (posts.length >= limit) return;
    }
  }
}

// ─────────────────────────────────────────────
// Scraping Strategies
// ─────────────────────────────────────────────

/**
 * Strategy 1a: i.instagram.com/api/v1/users/web_profile_info (mobile-style host)
 * Uses a bootstrapped CSRF cookie for better acceptance.
 */
async function strategyWebProfileInfoMobile(username: string, limit: number): Promise<ScrapedPost[]> {
  const ua = randomUA();
  const sess = await getSession();
  const res = await axios.get(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
    timeout: 18_000,
    headers: {
      'User-Agent': ua,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'X-IG-App-ID': IG_APP_ID,
      'X-ASBD-ID': IG_ASBD_ID,
      'X-IG-WWW-Claim': '0',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': sess.csrfToken,
      'Cookie': sess.cookies,
      'Referer': `https://www.instagram.com/${username}/`,
      'Origin': 'https://www.instagram.com',
    },
  });

  const user = res.data?.data?.user;
  if (!user) throw new Error('No user object in web_profile_info mobile response');
  if (user.is_private) throw new Error('PRIVATE_ACCOUNT');

  const posts: ScrapedPost[] = [];
  extractFromEdges(user.edge_owner_to_timeline_media?.edges, posts, limit);
  extractFromEdges(user.edge_felix_video_timeline?.edges, posts, limit);
  return posts;
}

/**
 * Strategy 1b: www.instagram.com/api/v1/users/web_profile_info (web host)
 * Uses a bootstrapped CSRF cookie for better acceptance.
 */
async function strategyWebProfileInfoWeb(username: string, limit: number): Promise<ScrapedPost[]> {
  const ua = randomUA();
  const sess = await getSession();
  const res = await axios.get(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
    timeout: 18_000,
    headers: {
      'User-Agent': ua,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'X-IG-App-ID': IG_APP_ID,
      'X-ASBD-ID': IG_ASBD_ID,
      'X-IG-WWW-Claim': '0',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': sess.csrfToken,
      'Cookie': sess.cookies,
      'Referer': `https://www.instagram.com/${username}/`,
    },
  });

  const user = res.data?.data?.user;
  if (!user) throw new Error('No user object in web_profile_info web response');
  if (user.is_private) throw new Error('PRIVATE_ACCOUNT');

  const posts: ScrapedPost[] = [];
  extractFromEdges(user.edge_owner_to_timeline_media?.edges, posts, limit);
  extractFromEdges(user.edge_felix_video_timeline?.edges, posts, limit);
  return posts;
}

/**
 * Strategy 2: Legacy ?__a=1 endpoint (still works on some IPs/regions)
 */
async function strategyLegacyA1(username: string, limit: number): Promise<ScrapedPost[]> {
  const ua = randomUA();
  const res = await axios.get(`https://www.instagram.com/${encodeURIComponent(username)}/?__a=1&__d=dis`, {
    timeout: 18_000,
    headers: {
      'User-Agent': ua,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-IG-App-ID': IG_APP_ID,
      'X-ASBD-ID': IG_ASBD_ID,
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `https://www.instagram.com/${username}/`,
    },
  });

  const json = res.data;
  const user = json?.graphql?.user || json?.data?.user || json?.user;
  if (!user) throw new Error('No user in ?__a=1 response');
  if (user.is_private) throw new Error('PRIVATE_ACCOUNT');

  const posts: ScrapedPost[] = [];
  extractFromEdges(user.edge_owner_to_timeline_media?.edges, posts, limit);
  extractFromEdges(user.edge_felix_video_timeline?.edges, posts, limit);
  return posts;
}

/**
 * Strategy 3: Full profile page HTML parsing — extract embedded JSON from <script> tags
 */
async function strategyHTMLParsing(username: string, limit: number): Promise<ScrapedPost[]> {
  const client = createClient(username);
  const res = await client.get(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  const html: string = res.data;

  if (html.includes('"is_private":true') && !html.includes('"edge_owner_to_timeline_media"')) {
    throw new Error('PRIVATE_ACCOUNT');
  }

  if (html.includes('Page Not Found') || html.includes('"user":null')) {
    throw new Error('USER_NOT_FOUND');
  }

  const posts: ScrapedPost[] = [];

  // Pattern 1: window._sharedData (older format, rarely present now)
  const sharedMatch = html.match(/window\._sharedData\s*=\s*({.+?});\s*<\/script>/s);
  if (sharedMatch) {
    try {
      const data = JSON.parse(sharedMatch[1]);
      const user = data?.entry_data?.ProfilePage?.[0]?.graphql?.user;
      if (user) {
        extractFromEdges(user.edge_owner_to_timeline_media?.edges, posts, limit);
        extractFromEdges(user.edge_felix_video_timeline?.edges, posts, limit);
      }
    } catch { /* ignore */ }
  }

  if (posts.length > 0) return posts.slice(0, limit);

  // Pattern 2: __additionalDataLoaded
  const addlMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\s*\);\s*<\/script>/s);
  if (addlMatch) {
    try {
      const data = JSON.parse(addlMatch[1]);
      const user = data?.graphql?.user || data?.user;
      if (user) {
        extractFromEdges(user.edge_owner_to_timeline_media?.edges, posts, limit);
        extractFromEdges(user.edge_felix_video_timeline?.edges, posts, limit);
      }
    } catch { /* ignore */ }
  }

  if (posts.length > 0) return posts.slice(0, limit);

  // Pattern 3: application/json script tags (modern Instagram embeds data this way)
  const scriptRegex = /<script[^>]*type="application\/json"[^>]*>({.+?})<\/script>/gs;
  const scriptMatches = [...html.matchAll(scriptRegex)];
  for (const match of scriptMatches) {
    try {
      const json = JSON.parse(match[1]);
      deepSearch(json, posts, limit);
      if (posts.length > 0) break;
    } catch { continue; }
  }

  if (posts.length > 0) return posts.slice(0, limit);

  // Pattern 4: RequiresDeferredConfig / PolarisProfilePostsTabQuery
  const requireMatch = html.match(/"require"\s*:\s*\[\s*\["ScheduledServerJS"[^\]]+\]\s*,\s*({.+?})\s*\]\s*\]/s);
  if (requireMatch) {
    try {
      const data = JSON.parse(requireMatch[1]);
      deepSearch(data, posts, limit);
    } catch { /* ignore */ }
  }

  return posts.slice(0, limit);
}

/**
 * Strategy 4: GraphQL endpoint with known query_hashes
 * First needs the user ID, which we extract from the profile page
 */
async function strategyGraphQL(username: string, limit: number): Promise<ScrapedPost[]> {
  // Get user ID from a quick profile page request
  const userId = await getUserId(username);
  if (!userId) throw new Error('Could not determine user ID for GraphQL strategy');

  const ua = randomUA();
  const posts: ScrapedPost[] = [];

  for (const queryHash of GRAPHQL_QUERY_HASHES) {
    if (posts.length >= limit) break;
    try {
      const variables = JSON.stringify({ id: userId, first: Math.min(limit, 50) });
      const res = await axios.get(`https://www.instagram.com/graphql/query/`, {
        timeout: 18_000,
        params: { query_hash: queryHash, variables },
        headers: {
          'User-Agent': ua,
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'X-IG-App-ID': IG_APP_ID,
          'X-ASBD-ID': IG_ASBD_ID,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `https://www.instagram.com/${username}/`,
        },
      });

      const edges = res.data?.data?.user?.edge_owner_to_timeline_media?.edges;
      if (Array.isArray(edges) && edges.length > 0) {
        extractFromEdges(edges, posts, limit);
        break;
      }
    } catch { /* try next hash */ }

    await delay(400, 900);
  }

  return posts;
}

/**
 * Strategy 5: Reels-specific endpoint (clips feed)
 */
async function strategyReelsFeed(username: string, limit: number): Promise<ScrapedPost[]> {
  const userId = await getUserId(username);
  if (!userId) throw new Error('Could not determine user ID for reels strategy');

  const ua = randomUA();
  const res = await axios.post(
    'https://www.instagram.com/api/v1/clips/user/',
    new URLSearchParams({
      target_user_id: userId,
      page_size: String(Math.min(limit, 50)),
      max_id: '',
      include_feed_video: '1',
    }),
    {
      timeout: 18_000,
      headers: {
        'User-Agent': ua,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-IG-App-ID': IG_APP_ID,
        'X-ASBD-ID': IG_ASBD_ID,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `https://www.instagram.com/${username}/reels/`,
        'Origin': 'https://www.instagram.com',
      },
    },
  );

  const items = res.data?.items;
  if (!Array.isArray(items)) throw new Error('No items in reels feed response');

  const posts: ScrapedPost[] = [];
  for (const item of items) {
    if (posts.length >= limit) break;
    const media = item?.media || item;
    if (!media) continue;

    const videoUrl = media.video_versions?.[0]?.url || media.video_url || '';
    if (!videoUrl) continue;

    const id = String(media.id || media.pk || '');
    if (!id) continue;

    posts.push({
      id,
      media_type: 'VIDEO',
      media_url: videoUrl,
      thumbnail_url: media.image_versions2?.candidates?.[0]?.url || media.thumbnail_src,
      caption: media.caption?.text || '',
      timestamp: media.taken_at ? new Date(media.taken_at * 1000).toISOString() : new Date().toISOString(),
      shortcode: media.code || media.shortcode,
      like_count: media.like_count,
      play_count: media.play_count,
      is_reel: true,
    });
  }

  return posts;
}

/**
 * Helper: Extract user ID from profile page HTML
 */
async function getUserId(username: string): Promise<string | null> {
  try {
    const res = await axios.get(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      timeout: 15_000,
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html: string = res.data;

    const patterns = [
      /"profilePage_(\d+)"/,
      /"user_id"\s*:\s*"(\d+)"/,
      /"owner"\s*:\s*\{\s*"id"\s*:\s*"(\d+)"/,
      /"id"\s*:\s*"(\d+)"\s*,\s*"username"\s*:\s*"[^"]+"/,
      /instagram:\/\/user\?username=\w+&uid=(\d+)/,
      /"pk"\s*:\s*"(\d+)"/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return match[1];
    }
  } catch { /* ignore */ }
  return null;
}

// ─────────────────────────────────────────────
// Main Service Class
// ─────────────────────────────────────────────

export class InstagramScraperService {
  /**
   * Scrape a public Instagram profile for posts and reels.
   *
   * Tries 5 strategies in cascade, each with a different Instagram endpoint.
   * Results are cached for 5 minutes to avoid rate limiting.
   *
   * @param username - Instagram username (with or without @)
   * @param limit    - Maximum number of posts to return (default: 20)
   * @returns Array of scraped posts (may include images, carousels and videos)
   */
  static async scrapeProfile(username: string, limit = 20): Promise<ScrapedPost[]> {
    const clean = username.replace(/^@+/, '').trim().toLowerCase();

    // Return cached result if available
    const cached = getCached(clean);
    if (cached) {
      logger.info(`[Scraper] Cache hit for @${clean} (${cached.length} posts)`);
      return cached.slice(0, limit);
    }

    logger.info(`[Scraper] Scraping @${clean} (limit: ${limit})`);

    const strategies: [string, () => Promise<ScrapedPost[]>][] = [
      ['web_profile_info (mobile host)', () => strategyWebProfileInfoMobile(clean, limit)],
      ['web_profile_info (web host)',   () => strategyWebProfileInfoWeb(clean, limit)],
      ['legacy ?__a=1',                 () => strategyLegacyA1(clean, limit)],
      ['HTML page parsing',             () => strategyHTMLParsing(clean, limit)],
      ['reels clips feed',              () => strategyReelsFeed(clean, limit)],
      ['GraphQL query',                 () => strategyGraphQL(clean, limit)],
    ];

    for (const [name, fn] of strategies) {
      try {
        logger.info(`[Scraper] Trying strategy: ${name} for @${clean}`);
        const posts = await fn();

        if (posts.length > 0) {
          logger.info(`[Scraper] ✓ Strategy "${name}" returned ${posts.length} posts for @${clean}`);
          setCached(clean, posts);
          return posts.slice(0, limit);
        }

        logger.warn(`[Scraper] Strategy "${name}" returned 0 posts for @${clean}, trying next...`);
      } catch (err: any) {
        const msg = err?.response?.status
          ? `HTTP ${err.response.status}: ${err.message}`
          : err.message;

        if (err.message === 'PRIVATE_ACCOUNT') {
          logger.warn(`[Scraper] @${clean} is a private account`);
          throw new Error(`@${clean} is a private account and cannot be scraped.`);
        }
        if (err.message === 'USER_NOT_FOUND') {
          logger.warn(`[Scraper] @${clean} not found`);
          throw new Error(`@${clean} does not exist or has been deleted.`);
        }

        logger.warn(`[Scraper] Strategy "${name}" failed for @${clean}: ${msg}`);
      }

      // Small delay between strategies to avoid triggering rate limits
      await delay(800, 2000);
    }

    logger.error(`[Scraper] All strategies exhausted for @${clean}`);
    return [];
  }

  /**
   * Clear the in-memory cache for a specific username, or all usernames.
   */
  static clearCache(username?: string): void {
    if (username) {
      cache.delete(username.toLowerCase());
    } else {
      cache.clear();
    }
  }

  /**
   * Get scraper cache stats for diagnostics.
   */
  static getCacheStats(): { size: number; entries: string[] } {
    return {
      size: cache.size,
      entries: [...cache.keys()],
    };
  }
}
