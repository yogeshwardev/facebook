import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const addMonitoredAccount = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { targetUsername } = req.body;

    if (!targetUsername) {
      return res.status(400).json({ success: false, message: 'Target username is required' });
    }

    // Clean username (remove @ if present)
    const username = targetUsername.replace(/^@/, '').trim();

    const account = await prisma.monitoredAccount.create({
      data: {
        userId,
        targetUsername: username
      }
    });

    res.status(201).json({
      success: true,
      message: 'Account added to monitoring watchlist',
      data: { account }
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Account is already being monitored' });
    }
    next(err);
  }
};

export const getMonitoredAccounts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const accounts = await prisma.monitoredAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: { accounts }
    });
  } catch (err) {
    next(err);
  }
};

export const deleteMonitoredAccount = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const account = await prisma.monitoredAccount.findUnique({ where: { id: id as string } });
    if (!account || account.userId !== userId) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    await prisma.monitoredAccount.delete({ where: { id: id as string } });

    res.json({ success: true, message: 'Account removed from monitoring' });
  } catch (err) {
    next(err);
  }
};

export const toggleMonitorStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { isActive } = req.body;

    const account = await prisma.monitoredAccount.findUnique({ where: { id: id as string } });
    if (!account || account.userId !== userId) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const updated = await prisma.monitoredAccount.update({
      where: { id: id as string },
      data: { isActive }
    });

    res.json({ success: true, data: { account: updated } });
  } catch (err) {
    next(err);
  }
};
