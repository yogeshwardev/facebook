import { Router } from 'express';
import { getDashboardStats } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/dashboard', authenticate, getDashboardStats);

export default router;
