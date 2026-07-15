import supertest from 'supertest';
import app from '../src/app';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const request = supertest(app);

describe('Auth API', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany(); // clean up
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const testUser = {
    email: 'test@example.com',
    password: 'password123'
  };

  it('should register a new user', async () => {
    const response = await request.post('/api/v1/auth/register')
      .send(testUser);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(testUser.email);
    expect(response.body.data.accessToken).toBeDefined();
  });

  it('should login an existing user', async () => {
    const response = await request.post('/api/v1/auth/login')
      .send(testUser);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeDefined();
  });
});
