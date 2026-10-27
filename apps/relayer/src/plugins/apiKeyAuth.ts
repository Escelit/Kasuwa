/**
 * API-key authentication plugin.
 *
 * Reads the key from the Authorization header: "Bearer <key>"
 * or from the X-Api-Key header.
 * Returns 401 if the key is missing or unknown.
 */
import {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyPluginAsync,
} from 'fastify';
import fp from 'fastify-plugin';

interface ApiKeyOptions {
  validKeys: Set<string>;
  /** Paths that bypass authentication (e.g. /healthz, /readyz) */
  publicPaths?: string[];
}

const apiKeyPlugin: FastifyPluginAsync<ApiKeyOptions> = async (
  app: FastifyInstance,
  opts: ApiKeyOptions,
) => {
  const publicPaths = new Set(opts.publicPaths ?? ['/healthz', '/readyz']);

  app.addHook(
    'onRequest',
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (publicPaths.has(req.routeOptions.url ?? req.url)) return;

      const authHeader = req.headers['authorization'];
      const xApiKey = req.headers['x-api-key'];

      let key: string | undefined;
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        key = authHeader.slice('Bearer '.length).trim();
      } else if (typeof xApiKey === 'string') {
        key = xApiKey.trim();
      }

      if (!key || !opts.validKeys.has(key)) {
        return reply.status(401).send({ error: 'Unauthorized: invalid or missing API key' });
      }
    },
  );
};

export const apiKeyAuth = fp(apiKeyPlugin, {
  name: 'kasuwa-api-key-auth',
  fastify: '4.x',
});
