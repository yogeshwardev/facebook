import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { PrismaClient } from '@prisma/client';
import { syncQueue } from '../queue/queues';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { storageProvider } from '../services/storage';
import { decrypt } from '../utils/crypto';
import { InstagramScraperService } from '../services/instagram-scraper.service';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export const addMonitoredAccount = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { targetUsername } = req.body;

    if (!targetUsername) {
      return res.status(400).json({ success: false, message: 'Target username is required' });
    }

    // Clean username (remove all leading @ if present)
    const username = targetUsername.replace(/^@+/, '').trim();

    const account = await prisma.monitoredAccount.create({
      data: {
        userId,
        targetUsername: username
      }
    });

    // Trigger an immediate sync
    await syncQueue.add('sync-job', { accountId: account.id });

    res.status(201).json({
      success: true,
      message: 'Account added to monitoring watchlist',
      data: { account }
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Account is already being monitored' });
    }
    next(err);
  }
};

export const getMonitoredAccounts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const accounts = await prisma.monitoredAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: { accounts }
    });
  } catch (err) {
    next(err);
  }
};

export const deleteMonitoredAccount = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const account = await prisma.monitoredAccount.findUnique({ where: { id: id as string } });
    if (!account || account.userId !== userId) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    await prisma.monitoredAccount.delete({ where: { id: id as string } });

    res.json({ success: true, message: 'Account removed from monitoring' });
  } catch (err) {
    next(err);
  }
};

export const toggleMonitorStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { isActive } = req.body;

    const account = await prisma.monitoredAccount.findUnique({ where: { id: id as string } });
    if (!account || account.userId !== userId) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const updated = await prisma.monitoredAccount.update({
      where: { id: id as string },
      data: { isActive }
    });

    res.json({ success: true, data: { account: updated } });
  } catch (err) {
    next(err);
  }
};

export const triggerSync = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    // We can just add a global sync job, or a specific one for this user
    await syncQueue.add('manual-sync-job', { userId });
    
    res.json({ success: true, message: 'Sync triggered successfully! Check your Calendar in a few minutes.' });
  } catch (err) {
    next(err);
  }
};

export const getAccountFeed = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const account = await prisma.monitoredAccount.findUnique({
      where: { id: id as string },
      include: {
        user: {
          include: { instagramAccounts: { where: { status: 'ACTIVE' }, take: 1 } }
        }
      }
    });

    if (!account || account.userId !== userId) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const igAccount = account.user.instagramAccounts[0];
    let mediaItems: any[] = [];
    const cleanUser = account.targetUsername.replace(/^@+/, '');
    const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 100);
    const sourcesTried: string[] = [];

    // Strategy 1: Try Meta Graph API business_discovery (if user has connected IG account)
    if (igAccount) {
      const decryptedToken = decrypt(igAccount.accessToken);
      try {
        sourcesTried.push('Meta Business Discovery');
        logger.info(`[Feed] Trying Meta Graph API for @${cleanUser} via connected account ${igAccount.instagramId}`);
        const igRes = await axios.get(`https://graph.facebook.com/v19.0/${igAccount.instagramId}`, {
          params: {
            fields: `business_discovery.username(${cleanUser}){media.limit(${limit}){id,media_type,media_url,caption,timestamp,thumbnail_url,permalink}}`,
            access_token: decryptedToken
          }
        });
        const mediaList = igRes.data?.business_discovery?.media?.data || [];
        logger.info(`[Feed] Meta Graph API returned ${mediaList.length} items for @${cleanUser}`);
        mediaItems = mediaList
          .map((item: any) => InstagramScraperService.normalizeMetaMedia(item))
          .filter(Boolean);
      } catch (err: any) {
        const errMsg = err.response?.data?.error?.message || err.message;
        logger.warn(`[Feed] Meta Graph API failed for @${cleanUser}: ${errMsg}`);
      }
    }

    // Strategy 2: Try Instagram's public web profile JSON.
    if (mediaItems.length === 0) {
      sourcesTried.push('Instagram Public Web');
      logger.info(`[Feed] Falling back to public web profile JSON for @${cleanUser}`);
      try {
        mediaItems = await InstagramScraperService.scrapePublicWebProfile(cleanUser, limit);
        logger.info(`[Feed] Public web profile returned ${mediaItems.length} items for @${cleanUser}`);
      } catch (webErr: any) {
        logger.warn(`[Feed] Public web profile failed for @${cleanUser}: ${webErr.message}`);
      }
    }

    // Strategy 3: Render the public profile and parse visible post links/thumbnails.
    if (mediaItems.length === 0) {
      sourcesTried.push('Instagram Rendered Profile');
      logger.info(`[Feed] Falling back to rendered profile scrape for @${cleanUser}`);
      try {
        mediaItems = await InstagramScraperService.scrapeRenderedProfile(cleanUser, limit);
        logger.info(`[Feed] Rendered profile returned ${mediaItems.length} items for @${cleanUser}`);
      } catch (browserErr: any) {
        logger.warn(`[Feed] Rendered profile failed for @${cleanUser}: ${browserErr.message}`);
      }
    }

    // Strategy 4: If direct methods returned nothing, use configured Apify actor for public profiles.
    if (mediaItems.length === 0 && InstagramScraperService.isConfigured()) {
      sourcesTried.push('Apify Instagram Scraper');
      logger.info(`[Feed] Falling back to Apify scraper for @${cleanUser}`);
      try {
        mediaItems = await InstagramScraperService.scrapeProfile(cleanUser, limit);
        logger.info(`[Feed] Scraper returned ${mediaItems.length} items for @${cleanUser}`);
      } catch (scraperErr: any) {
        logger.error(`[Feed] Scraper also failed for @${cleanUser}: ${scraperErr.message}`);
      }
    }

    // Attach sync status
    const videoIds = mediaItems.map((v: any) => v.id).filter(Boolean);
    let syncedIds = new Set<string>();
    if (videoIds.length > 0) {
      const syncedMedia = await prisma.media.findMany({
        where: { userId, sourceMediaId: { in: videoIds } },
        select: { sourceMediaId: true }
      });
      syncedIds = new Set(syncedMedia.map(m => m.sourceMediaId).filter((id): id is string => id !== null));
    }

    const feed = mediaItems.map((v: any) => ({
      id: v.id || v.shortcode || `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      media_type: v.media_type || 'IMAGE',
      media_url: v.media_url || v.thumbnail_url || '',
      caption: v.caption || '',
      timestamp: v.timestamp || new Date().toISOString(),
      thumbnail_url: v.thumbnail_url || v.media_url || '',
      permalink: v.permalink || '',
      provider: v.provider || 'meta',
      isSynced: syncedIds.has(v.id)
    }));

    res.json({
      success: true,
      message: feed.length === 0 ? `Could not fetch public posts for @${cleanUser}. Instagram may be blocking this server; configure APIFY_TOKEN for the managed scraper path.` : undefined,
      data: { feed, sourcesTried }
    });
  } catch (err: any) {
    logger.error(`[Feed] Unhandled error: ${err.message}`);
    if (err.isAxiosError && err.response?.data?.error?.message) {
      return res.status(400).json({ success: false, message: `Instagram API Error: ${err.response.data.error.message}` });
    }
    next(err);
  }
};

export const repostMedia = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { mediaId, mediaUrl, caption } = req.body;

    const account = await prisma.monitoredAccount.findUnique({
      where: { id: id as string },
      include: {
        user: {
          include: { instagramAccounts: { where: { status: 'ACTIVE' }, take: 1 } }
        }
      }
    });

    if (!account || account.userId !== userId) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const existing = await prisma.media.findUnique({ where: { sourceMediaId: mediaId } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Already reposted' });
    }

    // Download
    const videoRes = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
    const tempFilename = `repost-${Date.now()}.mp4`;
    const tempDir = path.join(process.cwd(), 'uploads', 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, tempFilename);
    await fs.writeFile(tempPath, videoRes.data);

    const fakeMulterFile = {
      path: tempPath,
      originalname: tempFilename,
      size: videoRes.data.length,
      mimetype: 'video/mp4'
    } as Express.Multer.File;

    const finalUrl = await storageProvider.uploadFile(fakeMulterFile, 'reels');

    const newMedia = await prisma.media.create({
      data: {
        userId,
        fileUrl: finalUrl,
        mimeType: 'video/mp4',
        fileSize: videoRes.data.length,
        uploadStatus: 'UPLOADED',
        sourceMediaId: mediaId
      }
    });

    const igAccount = account.user.instagramAccounts[0];
    const decryptedToken = decrypt(igAccount.accessToken);

    const newPost = await prisma.post.create({
      data: {
        userId,
        mediaId: newMedia.id,
        caption: caption || '',
        publishMode: 'NOW',
        status: 'PENDING',
        destinations: {
          create: { instagramAccountId: igAccount.id }
        }
      }
    });

    res.json({ success: true, message: 'Reposted successfully!', data: { post: newPost } });
  } catch (err: any) {
    if (err.isAxiosError && err.response?.data?.error?.message) {
      return res.status(400).json({ success: false, message: `Instagram API Error: ${err.response.data.error.message}` });
    }
    next(err);
  }
};
