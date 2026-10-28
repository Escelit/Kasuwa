/**
 * POST /v1/settlements — accepts one or many base64url PaymentAuthorizations.
 * GET  /v1/settlements/:paymentId — returns status and on-chain result.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { preValidate } from '../preValidate.js';
import { upsertRecord, getRecord } from '../settlementStore.js';
import { enqueueSettlement } from '../queue.js';
import { type RelayerConfig } from '../config.js';

const SubmitBodySchema = z.object({
  authorizations: z
    .array(z.string().min(1))
    .min(1)
    .describe('Array of base64url-encoded PaymentAuthorization payloads'),
});

type SubmitBody = z.infer<typeof SubmitBodySchema>;

interface SubmitItemResult {
  paymentId: string | null;
  status: 'accepted' | 'invalid';
  reason?: string;
}

export async function settlementRoutes(
  app: FastifyInstance,
  opts: { config: RelayerConfig },
): Promise<void> {
  // ── POST /v1/settlements ─────────────────────────────────────────────────
  app.post(
    '/v1/settlements',
    async (
      req: FastifyRequest<{ Body: SubmitBody }>,
      reply: FastifyReply,
    ) => {
      // Validate body shape
      const parsed = SubmitBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const { authorizations } = parsed.data;

      // Enforce per-batch size limit
      if (authorizations.length > opts.config.MAX_BATCH_SIZE) {
        return reply.status(400).send({
          error: `Batch too large: max ${opts.config.MAX_BATCH_SIZE} items`,
        });
      }

      const ctx = {
        contractId: Buffer.from(opts.config.VAULT_CONTRACT_ID, 'hex').length === 32
          ? Buffer.from(opts.config.VAULT_CONTRACT_ID, 'hex')
          : Buffer.alloc(32), // placeholder for non-hex contract IDs (Strkey)
        networkId: Buffer.alloc(32), // TODO: derive from STELLAR_NETWORK_PASSPHRASE SHA-256
      };

      const results: SubmitItemResult[] = [];

      for (const encoded of authorizations) {
        // Pre-validate strictly — invalid items never enqueue
        const validation = preValidate({
          encoded,
          devicePublicKeyHex: null, // Commit 7: sig check skipped (no indexer lookup yet)
          ctx,
        });

        if (!validation.ok) {
          results.push({ paymentId: null, status: 'invalid', reason: validation.reason });
          continue;
        }

        const { auth, paymentIdHex } = validation;

        // Idempotent upsert
        const [record, isNew] = upsertRecord(paymentIdHex, auth, encoded);

        if (isNew) {
          // First time — enqueue for submission
          await enqueueSettlement({ paymentId: paymentIdHex, rawBytesB64: encoded });
          req.log.info({ paymentId: paymentIdHex }, 'settlement accepted and enqueued');
        } else {
          req.log.info(
            { paymentId: paymentIdHex, status: record.status },
            'duplicate settlement submission — returning existing record',
          );
        }

        results.push({ paymentId: paymentIdHex, status: 'accepted' });
      }

      return reply.status(202).send({ results });
    },
  );

  // ── GET /v1/settlements/:paymentId ───────────────────────────────────────
  app.get(
    '/v1/settlements/:paymentId',
    async (
      req: FastifyRequest<{ Params: { paymentId: string } }>,
      reply: FastifyReply,
    ) => {
      const { paymentId } = req.params;
      const record = getRecord(paymentId);

      if (!record) {
        return reply.status(404).send({ error: 'Settlement not found', paymentId });
      }

      return reply.send({
        paymentId: record.paymentId,
        allowanceId: record.allowanceId,
        merchant: record.merchant,
        amount: record.amount.toString(),
        expiresAt: record.expiresAt,
        status: record.status,
        acceptedAt: record.acceptedAt,
        updatedAt: record.updatedAt,
        onChainResult: record.onChainResult,
        error: record.error,
        paid: record.paid !== undefined && record.paid !== null ? record.paid.toString() : null,
        shortfall: record.shortfall !== undefined && record.shortfall !== null ? record.shortfall.toString() : null,
      });
    },
  );
}
