import { publishWorker } from './publish.worker';
import { logger } from '../utils/logger';

export const startWorkers = () => {
  logger.info('Starting Background Workers...');
  publishWorker.on('ready', () => logger.info('Publish Worker is ready'));
};
