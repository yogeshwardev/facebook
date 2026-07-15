import { PrismaClient } from '@prisma/client';
import { publishQueue } from '../queue/queues';

const prisma = new PrismaClient();

export class PostService {
  static async schedulePost(userId: string, mediaId: string, caption: string, scheduledTime: Date, accountIds: string[]) {
    const isNow = scheduledTime.getTime() <= Date.now() + 60000;
    
    const post = await prisma.post.create({
      data: {
        userId,
        mediaId,
        caption,
        scheduledTime,
        publishMode: isNow ? 'NOW' : 'SCHEDULED',
        status: isNow ? 'PENDING' : 'SCHEDULED',
        destinations: {
          create: accountIds.map(accountId => ({
            instagramAccountId: accountId
          }))
        }
      }
    });

    const delay = isNow ? 0 : scheduledTime.getTime() - Date.now();
    
    const job = await publishQueue.add('publish-post', { postId: post.id }, {
      delay: Math.max(0, delay),
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false
    });

    await prisma.scheduledJob.create({
      data: {
        postId: post.id,
        jobId: job.id as string,
        queueName: 'publish-queue',
        status: 'WAITING'
      }
    });

    return post;
  }
}
