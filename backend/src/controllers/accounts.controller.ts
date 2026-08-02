import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { MetaService } from '../services/meta.service';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { encrypt, decrypt } from '../utils/crypto';
import { InstagramScraperService } from '../services/instagram-scraper.service';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export const getOAuthUrl = (req: AuthRequest, res: Response) => {
  const state = req.user!.userId;
  const url = MetaService.getOAuthUrl(state);
  res.json({ success: true, data: { url } });
};

export const oauthCallback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state: userId, error, error_description } = req.query;
    
    // In a real application, redirect to the frontend with an error or success parameter
    const FRONTEND_URL = process.env.FRONTEND_URL || 'https://fac.yogeshwar.me';
    
    if (error) {
      logger.error({ error, error_description }, 'OAuth Callback Error');
      return res.redirect(`${FRONTEND_URL}/dashboard?error=${error_description || error}`);
    }

    if (!code || typeof code !== 'string' || !userId || typeof userId !== 'string') {
      return res.redirect(`${FRONTEND_URL}/dashboard?error=invalid_request`);
    }

    const shortLivedToken = await MetaService.getAccessToken(code);
    const longLivedToken = await MetaService.getLongLivedToken(shortLivedToken);
    const pages = await MetaService.getPages(longLivedToken);
    
    logger.info(`Found ${pages.length} pages for user ${userId}`);

    let accountsFound = 0;

    for (const page of pages) {
      try {
        const igAccount = await MetaService.getInstagramAccount(page.id, page.access_token);
        
        logger.info(`Page ${page.id} - IG Account: ${JSON.stringify(igAccount)}`);
        
        if (igAccount && igAccount.id) {
          accountsFound++;
          const encryptedToken = encrypt(longLivedToken);
          
          const existingAccount = await prisma.instagramAccount.findFirst({
            where: { instagramId: igAccount.id, userId }
          });

          if (existingAccount) {
            await prisma.instagramAccount.update({
              where: { id: existingAccount.id },
              data: {
                username: igAccount.username,
                profilePicture: igAccount.profile_picture_url,
                accessToken: encryptedToken,
                pageId: page.id,
                status: 'ACTIVE',
                lastSyncAt: new Date()
              }
            });
          } else {
            await prisma.instagramAccount.create({
              data: {
                userId,
                instagramId: igAccount.id,
                username: igAccount.username,
                profilePicture: igAccount.profile_picture_url,
                accessToken: encryptedToken,
                pageId: page.id,
                status: 'ACTIVE',
                lastSyncAt: new Date()
              }
            });
          }
        }
      } catch (err: any) {
        logger.warn(`Failed to process page ${page.id} for IG account: ${err.message}`);
      }
    }
    
    logger.info(`Finished processing pages. Accounts saved: ${accountsFound}`);
    res.redirect(`${FRONTEND_URL}/accounts?success=true`);
  } catch (err: any) {
    logger.error({ err }, 'Fatal error during oauth callback');
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getConnectedAccounts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    
    const accounts = await prisma.instagramAccount.findMany({
      where: { userId },
      select: {
        id: true,
        instagramId: true,
        username: true,
        profilePicture: true,
        status: true,
        lastSyncAt: true,
        createdAt: true
      }
    });
    
    res.json({
      success: true,
      message: 'Accounts retrieved successfully',
      data: { accounts }
    });
  } catch (err) {
    next(err);
  }
};

export const getMyPageMedia = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    // 1. Fetch connected Instagram accounts
    const accounts = await prisma.instagramAccount.findMany({
      where: { userId, status: 'ACTIVE' }
    });

    // 2. Fetch local posts (uploaded / reposted / scheduled via app)
    const localPosts = await prisma.post.findMany({
      where: { userId },
      include: { media: true },
      orderBy: { createdAt: 'desc' }
    });

    const postsList: any[] = localPosts.map(p => ({
      id: p.id,
      source: 'APP',
      media_type: p.media.mimeType.startsWith('video') ? 'VIDEO' : 'IMAGE',
      media_url: p.media.fileUrl,
      caption: p.caption,
      status: p.status,
      scheduledTime: p.scheduledTime,
      timestamp: p.createdAt.toISOString()
    }));

    // 3. For each active connected Instagram account, fetch live posts & reels
    let liveMedia: any[] = [];

    for (const acc of accounts) {
      try {
        const decryptedToken = decrypt(acc.accessToken);
        const url = `https://graph.facebook.com/v19.0/${acc.instagramId}/media`;
        const igRes = await axios.get(url, {
          params: {
            fields: 'id,caption,media_type,media_url,permalink,timestamp,thumbnail_url',
            access_token: decryptedToken
          }
        });

        if (igRes.data?.data) {
          const items = igRes.data.data.map((m: any) => ({
            id: m.id,
            source: 'INSTAGRAM',
            accountUsername: acc.username,
            media_type: m.media_type,
            media_url: m.media_url || m.thumbnail_url,
            caption: m.caption || '',
            permalink: m.permalink,
            timestamp: m.timestamp,
            status: 'PUBLISHED'
          }));
          liveMedia.push(...items);
        }
      } catch (err: any) {
        logger.warn(`Could not fetch Graph API media for @${acc.username}, trying custom scraper fallback`);
        try {
          const scraped = await InstagramScraperService.scrapeProfile(acc.username, 20);
          const items = scraped.map((s: any) => ({
            id: s.id,
            source: 'INSTAGRAM',
            accountUsername: acc.username,
            media_type: s.media_type,
            media_url: s.media_url,
            caption: s.caption || '',
            timestamp: s.timestamp,
            status: 'PUBLISHED'
          }));
          liveMedia.push(...items);
        } catch {
          // Ignore fallback errors
        }
      }
    }

    // Merge and deduplicate by media_url / id
    const allMedia = [...postsList, ...liveMedia];

    res.json({
      success: true,
      data: {
        accounts: accounts.map(a => ({ id: a.id, username: a.username, profilePicture: a.profilePicture })),
        media: allMedia
      }
    });
  } catch (err) {
    next(err);
  }
};

