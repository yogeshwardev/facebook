import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

const prisma = new PrismaClient();

export class AuthService {
  static async register(email: string, passwordHash: string) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      const err: any = new Error('User already exists');
      err.status = 409;
      throw err;
    }
    return prisma.user.create({
      data: { email, passwordHash }
    });
  }

  static async findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }
  
  static async updateLastLogin(id: string) {
    return prisma.user.update({
      where: { id },
      data: { lastLogin: new Date() }
    });
  }

  static generateTokens(userId: string) {
    const accessToken = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ userId }, env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken };
  }
}
