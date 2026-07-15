import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { PostService } from '../services/post.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const schedulePost = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { mediaId, caption, scheduledTime, accountIds } = req.body;

    const media = await prisma.media.findFirst({ where: { id: mediaId, userId } });
    if (!media) return res.status(404).json({ success: false, message: 'Media not found' });

    const post = await PostService.schedulePost(userId, mediaId, caption, new Date(scheduledTime), accountIds);

    res.status(201).json({
      success: true,
      message: 'Post scheduled successfully',
      data: { post }
    });
  } catch (err) {
    next(err);
  }
};

export const getPosts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const posts = await prisma.post.findMany({
      where: { userId },
      include: { media: true, destinations: { include: { instagramAccount: true } } },
      orderBy: { scheduledTime: 'asc' }
    });
    res.json({ success: true, data: { posts } });
  } catch (err) {
    next(err);
  }
};
