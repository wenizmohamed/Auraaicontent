// Socket.IO job-progress namespace.
//
// Wire shape — frontend connects to /socket.io with auth.token=<JWT> in the
// handshake. After auth, clients call subscribe-job(jobId) to join the
// job:{jobId} room. Job state changes emit to all subscribers in real time.
//
// Why this exists: the previous polling pattern (jobsApi.get every 2s) burns
// 15 wasted requests per 30s image-gen job and feels laggy. Live socket
// streaming keeps the dashboard instant + reduces load.
//
// Design decisions:
//   - JWT auth on connection, not per-event — connection-bound trust.
//   - Per-job rooms (job:{id}) — emits scoped, no broadcast leakage.
//   - Single source of truth: queue.ts jobEvents emitter. The socket layer
//     subscribes once at boot and routes updates to the right room.
//   - Frontend gracefully degrades to polling if WS connect fails.
import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { verifyToken } from '../middleware/auth.js';
import { jobEvents, getJob, type Job } from '../workers/queue.js';

interface AuthedSocket extends Socket {
  data: {
    userId?: string;
    email?: string;
    role?: string;
  };
}

export function attachJobSockets(httpServer: HttpServer): SocketIOServer {
  const isProd = process.env.NODE_ENV === 'production';
  const corsOrigins = (() => {
    const raw = process.env.SOCKET_CORS_ORIGINS?.trim() || process.env.HTTP_CORS_ORIGINS?.trim();
    if (raw) return raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (isProd) return [];
    return [
      'http://127.0.0.1:3200',
      'http://localhost:3200',
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'app://.',
      'file://',
    ];
  })();

  const io = new SocketIOServer(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  // Connection auth — JWT from handshake.auth.token.
  io.use((socket, next) => {
    try {
      const token = (socket.handshake.auth as any)?.token
        || socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('Missing auth token'));
      const payload = verifyToken(token);
      (socket as AuthedSocket).data = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
      };
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket: AuthedSocket) => {
    socket.on('subscribe-job', (jobId: string, ack?: (res: { ok: boolean; job?: Job; error?: string }) => void) => {
      if (typeof jobId !== 'string' || !jobId) {
        ack?.({ ok: false, error: 'Invalid jobId' });
        return;
      }
      const job = getJob(jobId);
      if (!job) {
        ack?.({ ok: false, error: 'Job not found' });
        return;
      }
      socket.join(`job:${jobId}`);
      // Send current snapshot immediately so newly-subscribing clients
      // don't have to wait for the next progress tick.
      ack?.({ ok: true, job });
    });

    socket.on('unsubscribe-job', (jobId: string) => {
      if (typeof jobId === 'string' && jobId) {
        socket.leave(`job:${jobId}`);
      }
    });
  });

  // One global listener — fan out to per-job rooms.
  jobEvents.on('job:update', (job: Job) => {
    try {
      io.to(`job:${job.id}`).emit('job:update', job);
    } catch (err: any) {
      console.warn('[socket] job emit failed:', err?.message);
    }
  });

  return io;
}
