import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  addMonitoredAccount,
  getMonitoredAccounts,
  deleteMonitoredAccount,
  toggleMonitorStatus,
  triggerSync
} from '../controllers/monitor.controller';

const router = Router();

router.use(authenticate);

router.post('/', addMonitoredAccount);
router.get('/', getMonitoredAccounts);
router.post('/sync', triggerSync);
router.delete('/:id', deleteMonitoredAccount);
router.patch('/:id/status', toggleMonitorStatus);

export default router;
