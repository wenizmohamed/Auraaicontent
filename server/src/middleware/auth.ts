import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

// Short-lived default (24h) for a single workstation session.  Pass
// rememberMe=true for a 30-day token — the "keep me signed in" case.
// Long-lived access tokens are covered by the strict auth rate-limit
// bucket; a full refresh-token rotation layer is the next gold-standard
// upgrade but outside this change's scope.
export function signToken(payload: JwtPayload, rememberMe = false): string {
  const expiresIn = rememberMe ? '30d' : '24h';
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

// Fastify preHandler hook — attaches user to request
export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' });
  }

  try {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    (request as any).user = payload;
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}
