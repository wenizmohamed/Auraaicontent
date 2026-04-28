import type { FastifyInstance } from 'fastify';
import { db } from '../../db/prisma.js';
import { apiKeyGuard } from '../../middleware/api-key-guard.js';
import { ok, err } from './_common.js';

export async function v2CalendarRoutes(app: FastifyInstance) {
  app.addHook('preHandler', apiKeyGuard);

  // GET /v2/calendars — list non-archived months for the workspace.
  app.get('/calendars', async (request, reply) => {
    const { clientId } = request.apiKeyContext!;
    const months = await db.calendarMonth.findMany({
      where: { clientId, isArchived: false },
      orderBy: { month: 'desc' },
      select: {
        id: true,
        month: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { posts: true } },
      },
    });
    return ok(reply, months);
  });

  // GET /v2/calendars/:month — posts for one month (e.g. "2026-04" or "April 2026").
  app.get<{ Params: { month: string } }>('/calendars/:month', async (request, reply) => {
    const { clientId } = request.apiKeyContext!;
    const month = decodeURIComponent(request.params.month);
    const calendar = await db.calendarMonth.findFirst({
      where: { clientId, month },
      include: {
        posts: {
          orderBy: { date: 'asc' },
          select: {
            id: true,
            date: true,
            title: true,
            pillar: true,
            platform: true,
            format: true,
            hook: true,
            keyMessage: true,
            caption: true,
            cta: true,
            hashtags: true,
            visualDirection: true,
            timing: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!calendar) return err(reply, 'Calendar month not found', 404);
    return ok(reply, calendar);
  });
}
