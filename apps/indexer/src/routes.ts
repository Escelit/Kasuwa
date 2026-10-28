import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { IKasuwaDb } from '@kasuwa/db';
import { computeBalanceBucket } from './bucketing.js';

export async function indexerRoutes(
  app: FastifyInstance,
  opts: { db: IKasuwaDb },
): Promise<void> {
  const { db } = opts;

  // Liveness
  app.get('/healthz', async () => ({ status: 'ok', ts: Date.now() }));

  // Readiness
  app.get('/readyz', async () => ({ status: 'ready', ts: Date.now() }));

  // ── GET /v1/allowances/:id ───────────────────────────────────────────────
  app.get(
    '/v1/allowances/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.params;
      const allowance = await db.allowances.get(id);

      if (!allowance) {
        return reply.status(404).send({ error: 'Allowance not found', id });
      }

      const shortfalls = await db.shortfalls.countForDeviceKey(allowance.deviceKeyHex);
      const now = Math.floor(Date.now() / 1000);
      const ageSeconds = Math.max(0, now - allowance.createdAt);

      return reply.send({
        allowance_id: allowance.id,
        owner: allowance.owner,
        token: allowance.token,
        device_key_hex: allowance.deviceKeyHex,
        balance_bucket: computeBalanceBucket(allowance.balance),
        per_payment_cap: allowance.perPaymentCap,
        valid_until: allowance.validUntil,
        status: allowance.status,
        age_seconds: ageSeconds,
        shortfall_count: shortfalls.count,
        total_shortfall: shortfalls.totalAmount,
        updated_at: allowance.updatedAt,
      });
    },
  );

  // ── GET /v1/snapshots ────────────────────────────────────────────────────
  app.get(
    '/v1/snapshots',
    async (
      req: FastifyRequest<{
        Querystring: { since?: string; region?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const since = req.query.since ? parseInt(req.query.since, 10) : 0;
      const allowances = await db.allowances.listSnapshots(isNaN(since) ? 0 : since);

      const now = Math.floor(Date.now() / 1000);
      const snapshots = await Promise.all(
        allowances.map(async (a) => {
          const shortfalls = await db.shortfalls.countForDeviceKey(a.deviceKeyHex);
          return {
            allowance_id: a.id,
            owner: a.owner,
            balance_bucket: computeBalanceBucket(a.balance),
            valid_until: a.validUntil,
            age_seconds: Math.max(0, now - a.createdAt),
            shortfall_count: shortfalls.count,
            total_shortfall: shortfalls.totalAmount,
            status: a.status,
            snapshot_at: now,
          };
        }),
      );

      return reply.send({ snapshots, count: snapshots.length, synced_at: now });
    },
  );

  // ── GET /v1/merchants/:address/settlements ─────────────────────────────────
  app.get(
    '/v1/merchants/:address/settlements',
    async (
      req: FastifyRequest<{
        Params: { address: string };
        Querystring: { limit?: string; offset?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { address } = req.params;
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset ?? '0', 10) || 0);

      const result = await db.settlements.listByMerchant(address, limit, offset);

      return reply.send({
        merchant: address,
        settlements: result.items,
        total: result.total,
        limit,
        offset,
      });
    },
  );
}
