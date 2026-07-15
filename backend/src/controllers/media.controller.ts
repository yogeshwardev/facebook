import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { storageProvider } from '../services/storage';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const uploadMedia = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const userId = req.user!.userId;
    const url = await storageProvider.uploadFile(file, 'reels');

    const media = await prisma.media.create({
      data: {
        userId,
        fileUrl: url,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadStatus: 'UPLOADED'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Media uploaded successfully',
      data: { media }
    });
  } catch (err) {
    next(err);
  }
};

export const getMediaLibrary = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const media = await prisma.media.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      message: 'Media library retrieved',
      data: { media }
    });
  } catch (err) {
    next(err);
  }
};
