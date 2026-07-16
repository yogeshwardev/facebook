import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queue/connection';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { decrypt } from '../utils/crypto';
import axios from 'axios';

const prisma = new PrismaClient();

const processPublish = async (job: Job) => {
  const { postId } = job.data;
  
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { media: true, destinations: { include: { instagramAccount: true } } }
  });

  if (!post) throw new Error(`Post ${postId} not found`);

  await prisma.post.update({ where: { id: postId }, data: { status: 'PUBLISHING' } });

  for (const dest of post.destinations) {
    try {
      const accessToken = decrypt(dest.instagramAccount.accessToken);
      const igUserId = dest.instagramAccount.instagramId;
      
      const containerRes = await axios.post(`https://graph.facebook.com/v19.0/${igUserId}/media`, null, {
        params: {
          media_type: 'REELS',
          video_url: post.media.fileUrl,
          caption: post.caption,
          access_token: accessToken
        }
      });
      const containerId = containerRes.data.id;

      // Poll the container status until it's FINISHED
      let isFinished = false;
      let attempts = 0;
      while (!isFinished && attempts < 24) { // Up to 2 minutes
        await new Promise(r => setTimeout(r, 5000)); // wait 5s
        attempts++;

        const statusRes = await axios.get(`https://graph.facebook.com/v19.0/${containerId}`, {
          params: {
            fields: 'status_code',
            access_token: accessToken
          }
        });

        const statusCode = statusRes.data.status_code;
        if (statusCode === 'FINISHED') {
          isFinished = true;
        } else if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
          throw new Error(`Media container processing failed with status: ${statusCode}`);
        }
        // If IN_PROGRESS or anything else, keep looping
      }

      if (!isFinished) {
        throw new Error('Media container processing timed out after 2 minutes');
      }

      const publishRes = await axios.post(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, null, {
        params: {
          creation_id: containerId,
          access_token: accessToken
        }
      });

      const platformPostId = publishRes.data.id;

      await prisma.postAccountDestination.update({
        where: { id: dest.id },
        data: { status: 'PUBLISHED', platformPostId }
      });

    } catch (err: any) {
      logger.error({ err: err.response?.data || err.message }, 'Failed to publish to destination');
      await prisma.postAccountDestination.update({
        where: { id: dest.id },
        data: { status: 'FAILED', errorMessage: err.message }
      });
      throw err; 
    }
  }

  await prisma.post.update({
    where: { id: postId },
    data: { status: 'PUBLISHED', publishedAt: new Date() }
  });
};

export const publishWorker = new Worker('publish-queue', processPublish, { 
  connection: redisConnection as any,
  concurrency: 5
});

publishWorker.on('failed', async (job, err) => {
  logger.error(`Job ${job?.id} failed: ${err.message}`);
  if (job?.data.postId) {
    await prisma.post.update({
      where: { id: job.data.postId },
      data: { status: 'FAILED', errorMessage: err.message }
    });
  }
});
