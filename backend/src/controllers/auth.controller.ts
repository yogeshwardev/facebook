import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { AuthService } from '../services/auth.service';

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await AuthService.register(email, passwordHash);
    
    const { accessToken, refreshToken } = AuthService.generateTokens(user.id);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: { user: { id: user.id, email: user.email }, accessToken, refreshToken }
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const user = await AuthService.findByEmail(email);
    
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    await AuthService.updateLastLogin(user.id);
    const { accessToken, refreshToken } = AuthService.generateTokens(user.id);

    res.json({
      success: true,
      message: 'Logged in successfully',
      data: { user: { id: user.id, email: user.email }, accessToken, refreshToken }
    });
  } catch (error) {
    next(error);
  }
};
