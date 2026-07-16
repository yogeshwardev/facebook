import { Worker } from 'bullmq';
import { redisConnection } from '../queue/connection';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { storageProvider } from '../services/storage';

const prisma = new PrismaClient();

export const syncWorker = new Worker('sync-queue', async (job) => {
  logger.info(`Starting sync job ${job.id}`);
  
  // Find all active monitored accounts
  const accounts = await prisma.monitoredAccount.findMany({
    where: { isActive: true },
    include: {
      user: {
        include: {
          instagramAccounts: {
            where: { status: 'ACTIVE' },
            take: 1
          }
        }
      }
    }
  });

  for (const account of accounts) {
    try {
      const igAccount = account.user.instagramAccounts[0];
      if (!igAccount) continue;

      logger.info(`Checking target @${account.targetUsername} for user ${account.userId}`);

      // Use Business Discovery API to fetch target user's media
      const res = await axios.get(`https://graph.facebook.com/v19.0/${igAccount.instagramId}`, {
        params: {
          fields: `business_discovery.username(${account.targetUsername}){media{id,media_type,media_url,caption,timestamp}}`,
          access_token: igAccount.accessToken
        }
      });

      const mediaList = res.data?.business_discovery?.media?.data || [];
      if (mediaList.length === 0) continue;

      // Find the most recent video
      const latestVideo = mediaList.find((m: any) => m.media_type === 'VIDEO');
      if (!latestVideo) continue;

      // Check if we've already synced this media
      const existing = await prisma.media.findUnique({
        where: { sourceMediaId: latestVideo.id }
      });

      if (existing) {
        logger.info(`Media ${latestVideo.id} already synced.`);
        continue;
      }

      logger.info(`Found new Reel! Downloading ${latestVideo.id}...`);

      // Download the video
      const videoRes = await axios.get(latestVideo.media_url, { responseType: 'arraybuffer' });
      
      const tempFilename = `sync-${Date.now()}.mp4`;
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

      // Create Media record
      const newMedia = await prisma.media.create({
        data: {
          userId: account.userId,
          fileUrl: finalUrl,
          mimeType: 'video/mp4',
          fileSize: videoRes.data.length,
          uploadStatus: 'UPLOADED',
          sourceMediaId: latestVideo.id
        }
      });

      // Create Post record (SCHEDULED immediately to let the publish worker pick it up if publishMode=NOW)
      // Actually we will set it to PENDING so it shows in Calendar as a draft, or we can publish it!
      // The user wants: "that should be uploded in our page too". Let's set it to NOW and PENDING, so it uploads instantly!
      
      const newPost = await prisma.post.create({
        data: {
          userId: account.userId,
          mediaId: newMedia.id,
          caption: latestVideo.caption || `Repost from @${account.targetUsername}`,
          publishMode: 'NOW',
          status: 'PENDING',
          destinations: {
            create: {
              instagramAccountId: igAccount.id
            }
          }
        }
      });

      logger.info(`Successfully synced and scheduled new reel for @${account.targetUsername}`);

      // Update last checked
      await prisma.monitoredAccount.update({
        where: { id: account.id },
        data: { lastCheckedAt: new Date() }
      });

    } catch (err: any) {
      logger.error(`Failed to sync for monitored account ${account.id}: ${err.message}`);
    }
  }

}, { connection: redisConnection as any });
