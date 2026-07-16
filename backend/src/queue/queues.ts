import { Queue } from 'bullmq';
import { redisConnection } from './connection';

export const publishQueue = new Queue('publish-queue', { connection: redisConnection as any });
export const cleanupQueue = new Queue('cleanup-queue', { connection: redisConnection as any });
export const analyticsQueue = new Queue('analytics-queue', { connection: redisConnection as any });
export const syncQueue = new Queue('sync-queue', { connection: redisConnection as any });
