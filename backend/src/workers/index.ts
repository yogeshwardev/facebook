import { publishWorker } from './publish.worker';
import { syncWorker } from './sync.worker';
import { syncQueue } from '../queue/queues';
import { logger } from '../utils/logger';

export const startWorkers = async () => {
  logger.info('Starting Background Workers...');
  publishWorker.on('ready', () => logger.info('Publish Worker is ready'));
  syncWorker.on('ready', () => logger.info('Sync Worker is ready'));

  // Add the recurring sync job (every 1 hour)
  await syncQueue.add('sync-job', {}, {
    repeat: { pattern: '0 * * * *' },
    jobId: 'recurring-sync-job'
  });
};
