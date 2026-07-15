import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getDashboardStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    
    const [accountsCount, scheduledCount, publishedCount] = await Promise.all([
      prisma.instagramAccount.count({ where: { userId, status: 'ACTIVE' } }),
      prisma.post.count({ where: { userId, status: 'SCHEDULED' } }),
      prisma.post.count({ where: { userId, status: 'PUBLISHED' } }),
    ]);

    res.json({
      success: true,
      data: {
        accounts: accountsCount,
        scheduled: scheduledCount,
        published: publishedCount
      }
    });
  } catch (err) {
    next(err);
  }
};
