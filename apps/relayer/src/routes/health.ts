/**
 * Health and readiness routes.
 * GET /healthz — liveness (always 200 if process is up)
 * GET /readyz  — readiness (checks DB + Redis; stub for Commit 7)
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ status: 'ok', ts: Date.now() });
  });

  app.get('/readyz', async (_req: FastifyRequest, reply: FastifyReply) => {
    // TODO Commit 8: actually probe DB and Redis connections
    return reply.send({ status: 'ready', ts: Date.now() });
  });
}
