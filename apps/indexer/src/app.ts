import Fastify, { FastifyInstance } from 'fastify';
import { IKasuwaDb, InMemoryKasuwaDb } from '@kasuwa/db';
import { indexerRoutes } from './routes.js';

export async function buildIndexerApp(opts?: {
  db?: IKasuwaDb;
}): Promise<FastifyInstance> {
  const db = opts?.db ?? new InMemoryKasuwaDb();

  const app = Fastify({
    logger: false,
  });

  await app.register(indexerRoutes, { db });

  return app;
}
