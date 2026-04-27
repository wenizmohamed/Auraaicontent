import type { FastifyReply } from 'fastify';
import type { ZodSchema } from 'zod';

/**
 * Parse a request body against a zod schema; on failure send a 400 with
 * a friendly first-issue message + full issues list, and return null so
 * the caller can short-circuit:
 *
 *     const body = parseOr400(MySchema, request.body, reply);
 *     if (!body) return;
 *     // body is fully typed from here
 *
 * Returning null (not undefined) so it composes cleanly with `if (!body)`
 * even when the schema permits an empty object as a valid value.
 */
export function parseOr400<T>(schema: ZodSchema<T>, body: unknown, reply: FastifyReply): T | null {
  const r = schema.safeParse(body);
  if (!r.success) {
    const first = r.error.issues[0];
    reply.status(400).send({
      error: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body',
      issues: r.error.issues,
    });
    return null;
  }
  return r.data;
}
