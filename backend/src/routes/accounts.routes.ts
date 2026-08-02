import { Router } from 'express';
import { getOAuthUrl, oauthCallback, getConnectedAccounts, getMyPageMedia } from '../controllers/accounts.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Retrieve Meta OAuth URL (Protected, initiated by user)
router.get('/connect', authenticate, getOAuthUrl);

// OAuth Callback from Meta (Public, redirect from Meta)
router.get('/oauth/callback', oauthCallback);

// Get Connected Accounts (Protected)
router.get('/', authenticate, getConnectedAccounts);

// Get My Page Media (All posts & reels)
router.get('/my-page', authenticate, getMyPageMedia);

export default router;
