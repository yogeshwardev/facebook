import { Router } from 'express';
import { getOAuthUrl, oauthCallback, getConnectedAccounts } from '../controllers/accounts.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Retrieve Meta OAuth URL (Protected, initiated by user)
router.get('/connect', authenticate, getOAuthUrl);

// OAuth Callback from Meta (Public, redirect from Meta)
router.get('/oauth/callback', oauthCallback);

// Get Connected Accounts (Protected)
router.get('/', authenticate, getConnectedAccounts);

export default router;
