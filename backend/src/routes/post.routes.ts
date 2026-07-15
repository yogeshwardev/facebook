import { Router } from 'express';
import { schedulePost, getPosts } from '../controllers/post.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/schedule', authenticate, schedulePost);
router.get('/', authenticate, getPosts);

export default router;
