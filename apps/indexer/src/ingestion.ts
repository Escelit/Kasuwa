import { IKasuwaDb } from '@kasuwa/db';
import { IndexerConfig } from './config.js';

export interface IngestionEvent {
  id: string;
  ledger: number;
  ledgerClosedAt: number;
  contractId: string;
  eventType: 'created' | 'top_up' | 'close_req' | 'reclaim' | 'settle';
  allowanceId: string;
  paymentId?: string;
  data: {
    owner?: string;
    token?: string;
    deviceKeyHex?: string;
    amount?: string;
    balance?: string;
    perPaymentCap?: string;
    validUntil?: number;
    closeRequestedAt?: number;
    merchant?: string;
    paid?: string;
    shortfall?: string;
    settleResult?: 'Settled' | 'Partial' | 'Insufficient';
  };
}

export interface SorobanRpcEventStreamer {
  getLatestLedger(): Promise<number>;
  fetchEvents(startLedger: number, cursor?: string): Promise<{
    events: IngestionEvent[];
    latestLedger: number;
    cursor?: string;
  }>;
}

export class IngestionService {
  private readonly db: IKasuwaDb;
  private readonly config: IndexerConfig;
  private readonly streamer?: SorobanRpcEventStreamer;
  private isProcessing = false;

  constructor(opts: {
    db: IKasuwaDb;
    config: IndexerConfig;
    streamer?: SorobanRpcEventStreamer;
  }) {
    this.db = opts.db;
    this.config = opts.config;
    this.streamer = opts.streamer;
  }

  /**
   * Processes a list of events sequentially and idempotently into Postgres.
   */
  async ingestEvents(events: IngestionEvent[], checkpointCursor?: string): Promise<number> {
    let ingestedCount = 0;

    for (const event of events) {
      await this.processSingleEvent(event);
      ingestedCount++;

      // Update cursor if provided
      if (checkpointCursor) {
        await this.db.cursor.set(event.ledger, checkpointCursor);
      }
    }

    return ingestedCount;
  }

  /**
   * Ingests a single event into the appropriate tables. Idempotent.
   */
  async processSingleEvent(event: IngestionEvent): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    switch (event.eventType) {
      case 'created': {
        const d = event.data;
        await this.db.allowances.upsert({
          id: event.allowanceId,
          owner: d.owner ?? 'UNKNOWN',
          token: d.token ?? 'UNKNOWN',
          deviceKeyHex: d.deviceKeyHex ?? '04' + '00'.repeat(64),
          balance: d.amount ?? '0',
          perPaymentCap: d.perPaymentCap ?? d.amount ?? '0',
          validUntil: d.validUntil ?? (now + 86400 * 7),
          closeRequestedAt: null,
          status: 'Active',
          createdAt: event.ledgerClosedAt || now,
          updatedAt: now,
        });
        break;
      }

      case 'top_up': {
        const d = event.data;
        if (d.balance) {
          await this.db.allowances.updateBalance(event.allowanceId, d.balance);
        } else if (d.amount) {
          const current = await this.db.allowances.get(event.allowanceId);
          if (current) {
            const newBal = (BigInt(current.balance) + BigInt(d.amount)).toString();
            await this.db.allowances.updateBalance(event.allowanceId, newBal);
          }
        }
        break;
      }

      case 'close_req': {
        const closeTs = event.data.closeRequestedAt ?? now;
        await this.db.allowances.updateStatus(event.allowanceId, 'Closing', closeTs);
        break;
      }

      case 'reclaim': {
        // Marks allowance Closed and sets balance to 0
        await this.db.allowances.updateStatus(event.allowanceId, 'Closed');
        await this.db.allowances.updateBalance(event.allowanceId, '0');
        break;
      }

      case 'settle': {
        const d = event.data;
        const paymentId = event.paymentId ?? event.id;
        const allowanceId = event.allowanceId;
        const merchant = d.merchant ?? 'UNKNOWN';

        if (d.settleResult === 'Settled') {
          // Paid in full
          const amount = d.amount ?? d.paid ?? '0';
          await this.db.settlements.upsert({
            paymentId,
            allowanceId,
            merchant,
            amount,
            expiresAt: now + 3600,
            status: 'settled',
            paid: amount,
            shortfall: '0',
            onChainResult: 'Settled',
            acceptedAt: event.ledgerClosedAt || now,
            updatedAt: now,
          });

          // Decrement balance
          const allowance = await this.db.allowances.get(allowanceId);
          if (allowance) {
            const newBal = (BigInt(allowance.balance) - BigInt(amount)).toString();
            await this.db.allowances.updateBalance(allowanceId, newBal);
          }
        } else if (d.settleResult === 'Partial') {
          // Partial payment
          const paid = d.paid ?? '0';
          const shortfall = d.shortfall ?? '0';
          const totalAmount = (BigInt(paid) + BigInt(shortfall)).toString();

          await this.db.settlements.upsert({
            paymentId,
            allowanceId,
            merchant,
            amount: totalAmount,
            expiresAt: now + 3600,
            status: 'partial',
            paid,
            shortfall,
            onChainResult: 'Partial',
            acceptedAt: event.ledgerClosedAt || now,
            updatedAt: now,
          });

          // Balance reaches 0 on partial settlement
          await this.db.allowances.updateBalance(allowanceId, '0');

          // Record shortfall against device key
          const allowance = await this.db.allowances.get(allowanceId);
          if (allowance) {
            await this.db.shortfalls.record({
              deviceKeyHex: allowance.deviceKeyHex,
              allowanceId,
              merchant,
              amount: shortfall,
              timestamp: event.ledgerClosedAt || now,
            });
          }
        } else if (d.settleResult === 'Insufficient') {
          // Insufficient balance (0 paid, entire amount is shortfall)
          const shortfall = d.shortfall ?? d.amount ?? '0';
          await this.db.settlements.upsert({
            paymentId,
            allowanceId,
            merchant,
            amount: shortfall,
            expiresAt: now + 3600,
            status: 'rejected',
            paid: '0',
            shortfall,
            onChainResult: 'Insufficient',
            acceptedAt: event.ledgerClosedAt || now,
            updatedAt: now,
          });

          const allowance = await this.db.allowances.get(allowanceId);
          if (allowance) {
            await this.db.shortfalls.record({
              deviceKeyHex: allowance.deviceKeyHex,
              allowanceId,
              merchant,
              amount: shortfall,
              timestamp: event.ledgerClosedAt || now,
            });
          }
        }
        break;
      }
    }
  }

  /**
   * Polls Soroban RPC for new events starting from stored cursor.
   * Handles retention gaps and confirmation depth.
   */
  async poll(): Promise<{ ingested: number; gapDetected?: boolean }> {
    if (!this.streamer) return { ingested: 0 };
    if (this.isProcessing) return { ingested: 0 };

    this.isProcessing = true;
    try {
      const cursorRow = await this.db.cursor.get();
      const latestLedger = await this.streamer.getLatestLedger();

      // Enforce confirmation depth (1 ledger for Stellar finality)
      const maxTargetLedger = latestLedger - (this.config.CONFIRMATION_DEPTH - 1);
      const startLedger = cursorRow
        ? cursorRow.lastLedger + 1
        : this.config.START_LEDGER ?? Math.max(1, latestLedger - 100);

      if (startLedger > maxTargetLedger) {
        return { ingested: 0 };
      }

      try {
        const { events, cursor } = await this.streamer.fetchEvents(
          startLedger,
          cursorRow?.lastCursor,
        );
        const count = await this.ingestEvents(events, cursor);
        return { ingested: count };
      } catch (err: any) {
        const msg = String(err);
        if (msg.includes('gap') || msg.includes('retention') || msg.includes('missing')) {
          console.error(
            `[gap detected] Soroban RPC retention gap detected for ledger ${startLedger}. ` +
              `Run backfill mode to recover historical events from archive nodes.`,
          );
          return { ingested: 0, gapDetected: true };
        }
        throw err;
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
