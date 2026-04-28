import crypto from 'crypto';
import type { FastifyReply } from 'fastify';

// Envelope shape ported from aura-manus/backend/v2/_common.py:15–37.
// Every /v2 response wraps the payload + a request_id for client-side
// correlation. Errors return ok:false with a message string.

export function newRequestId(): string {
  return `req_${crypto.randomBytes(8).toString('hex')}`;
}

export function ok<T>(reply: FastifyReply, data: T, status = 200) {
  return reply.status(status).send({
    ok: true,
    request_id: newRequestId(),
    data,
  });
}

export function err(reply: FastifyReply, message: string, status = 400, extra?: Record<string, unknown>) {
  return reply.status(status).send({
    ok: false,
    request_id: newRequestId(),
    error: message,
    ...(extra || {}),
  });
}
