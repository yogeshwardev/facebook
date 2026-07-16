import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import accountsRoutes from './routes/accounts.routes';
import mediaRoutes from './routes/media.routes';
import postRoutes from './routes/post.routes';
import monitorRoutes from './routes/monitor.routes';
import analyticsRoutes from './routes/analytics.routes';
import path from 'path';

const app: Express = express();

// Security Middlewares
app.use(helmet());
app.use(cors());

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logging
app.use(pinoHttp({ logger }));

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'System is healthy',
    data: {
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }
  });
});

// Static files for local storage
app.use('/api/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/accounts', accountsRoutes);
app.use('/api/v1/media', mediaRoutes);
app.use('/api/v1/posts', postRoutes);
app.use('/api/v1/monitor', monitorRoutes);
app.use('/api/v1/analytics', analyticsRoutes);

// Global Error Handler
app.use(errorHandler);

export default app;
