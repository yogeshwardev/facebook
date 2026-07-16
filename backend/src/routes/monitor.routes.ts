import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  addMonitoredAccount,
  getMonitoredAccounts,
  deleteMonitoredAccount,
  toggleMonitorStatus,
  triggerSync,
  getAccountFeed,
  repostMedia
} from '../controllers/monitor.controller';

const router = Router();

router.use(authenticate);

router.post('/', addMonitoredAccount);
router.get('/', getMonitoredAccounts);
router.post('/sync', triggerSync);
router.get('/:id/feed', getAccountFeed);
router.post('/:id/repost', repostMedia);
router.delete('/:id', deleteMonitoredAccount);
router.patch('/:id/status', toggleMonitorStatus);

export default router;
