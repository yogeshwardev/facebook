import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { startWorkers } from './workers';

const port = env.PORT || 3000;

app.listen(port, () => {
  logger.info(`Server running on port ${port} in ${process.env.NODE_ENV || 'development'} mode`);
  startWorkers();
});
