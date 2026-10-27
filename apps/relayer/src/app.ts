/**
 * Fastify application factory.
 * Separated from index.ts so it can be imported in tests without starting the server.
 */
import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { loadConfig, parseApiKeys, type RelayerConfig } from './config.js';
import { apiKeyAuth } from './plugins/apiKeyAuth.js';
import { healthRoutes } from './routes/health.js';
import { settlementRoutes } from './routes/settlements.js';

export async function buildApp(
  overrideConfig?: Partial<RelayerConfig>,
): Promise<FastifyInstance> {
  const config = { ...loadConfig(), ...overrideConfig };
  const apiKeys = parseApiKeys(config.RELAYER_API_KEYS);

  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : 'info',
      // pino structured logging
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // Rate limiting: 100 req / minute per IP (adjustable per key in Commit 8)
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    skipOnError: true,
  });

  // API-key auth (skips /healthz, /readyz)
  await app.register(apiKeyAuth, { validKeys: apiKeys });

  // Routes
  await app.register(healthRoutes);
  await app.register(settlementRoutes, { config });

  return app;
}
