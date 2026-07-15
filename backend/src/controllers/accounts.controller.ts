import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { MetaService } from '../services/meta.service';
import { PrismaClient } from '@prisma/client';
import { encrypt } from '../utils/crypto';
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
