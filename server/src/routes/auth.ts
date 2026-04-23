import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '../db/prisma.js';
import { signToken, authGuard, type JwtPayload } from '../middleware/auth.js';

export async function authRoutes(app: FastifyInstance) {

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const { email, password, rememberMe } = request.body as {
      email: string;
      password: string;
      rememberMe?: boolean;
    };

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required' });
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = signToken(
      { userId: user.id, email: user.email, role: user.role },
      Boolean(rememberMe),
    );
    return {
      token,
      rememberMe: Boolean(rememberMe),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  });

  // POST /api/auth/logout
  app.post('/logout', async () => {
    // Stateless JWT — client discards token. Server-side token blocklist is a future enhancement.
    return { success: true };
  });

  // GET /api/auth/me — requires valid token
  app.get('/me', { preHandler: [authGuard] }, async (request) => {
    const { userId } = (request as any).user as JwtPayload;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }
    return user;
  });

  // POST /api/auth/register — dev convenience, disable in production
  app.post('/register', async (request, reply) => {
    const { email, password, name, rememberMe } = request.body as {
      email: string;
      password: string;
      name: string;
      rememberMe?: boolean;
    };

    if (!email || !password || !name) {
      return reply.status(400).send({ error: 'Email, password, and name required' });
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: { email, passwordHash, name, role: 'member' },
      select: { id: true, email: true, name: true, role: true },
    });

    const token = signToken(
      { userId: user.id, email: user.email, role: user.role },
      Boolean(rememberMe),
    );
    return { token, rememberMe: Boolean(rememberMe), user };
  });
}
