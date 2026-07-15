import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string(),
  PORT: z.string().default('3000'),
  JWT_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  ENCRYPTION_KEY: z.string().min(32),
  REDIS_URL: z.string(),
  FACEBOOK_APP_ID: z.string().default('test_id'),
  FACEBOOK_APP_SECRET: z.string().default('test_secret'),
  FACEBOOK_REDIRECT_URI: z.string().default('http://localhost:3000/api/v1/accounts/oauth/callback')
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('Invalid environment variables', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
