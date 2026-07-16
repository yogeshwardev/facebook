import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { PrismaClient } from '@prisma/client';
import { syncQueue } from '../queue/queues';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { storageProvider } from '../services/storage';
import { decrypt } from '../utils/crypto';
import { ApifyService } from '../services/apify.service';
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
    if (!igAccount) {
      return res.status(400).json({ success: false, message: 'No active Instagram account found to query from' });
    }

    const decryptedToken = decrypt(igAccount.accessToken);

    let videos: any[] = [];
    
    try {
      const igRes = await axios.get(`https://graph.facebook.com/v19.0/${igAccount.instagramId}`, {
        params: {
          fields: `business_discovery.username(${account.targetUsername}){media{id,media_type,media_url,caption,timestamp}}`,
          access_token: decryptedToken
        }
      });
      const mediaList = igRes.data?.business_discovery?.media?.data || [];
      videos = mediaList.filter((m: any) => m.media_type === 'VIDEO');
      } catch (err: any) {
        logger.info(`Official API failed for @${account.targetUsername}, falling back to Apify`);
        videos = await ApifyService.getInstagramReels(account.targetUsername.replace(/^@+/, ''));
      }

    // Attach sync status
    const syncedMedia = await prisma.media.findMany({
      where: { sourceMediaId: { in: videos.map((v: any) => v.id) } },
      select: { sourceMediaId: true }
    });
    
    const syncedIds = new Set(syncedMedia.map(m => m.sourceMediaId));

    const feed = videos.map((v: any) => ({
      ...v,
      isSynced: syncedIds.has(v.id)
    }));

    res.json({ success: true, data: { feed } });
  } catch (err: any) {
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
