/**
 * Health and readiness routes.
 * GET /healthz — liveness (always 200 if process is up)
 * GET /readyz  — readiness (checks DB + Redis health)
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type IKasuwaDb } from '@kasuwa/db';

export async function healthRoutes(
  app: FastifyInstance,
  opts?: { db?: IKasuwaDb; checkRedis?: () => Promise<boolean> },
): Promise<void> {
  app.get('/healthz', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ status: 'ok', ts: Date.now() });
  });

  app.get('/readyz', async (_req: FastifyRequest, reply: FastifyReply) => {
    let dbStatus = 'ok';
    let redisStatus = 'ok';

    if (opts?.db) {
      try {
        await opts.db.cursor.get();
      } catch (err) {
        dbStatus = 'degraded';
      }
    }

    if (opts?.checkRedis) {
      try {
        const ok = await opts.checkRedis();
        if (!ok) redisStatus = 'degraded';
      } catch {
        redisStatus = 'degraded';
      }
    }

    const isReady = dbStatus === 'ok' && redisStatus === 'ok';
    const statusCode = isReady ? 200 : 503;

    return reply.status(statusCode).send({
      status: isReady ? 'ready' : 'unhealthy',
      db: dbStatus,
      redis: redisStatus,
      ts: Date.now(),
    });
  });
}
