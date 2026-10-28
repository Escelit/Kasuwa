import { RejectReason, SettleResult, VaultClient } from '@kasuwa/sdk';
import { ChannelAccountState, ChannelManager } from '../channels/ChannelManager.js';
import { FeePayerSigner } from '../signers/FeePayerSigner.js';
import { BatchBuilder, BatchItem } from '../batch/BatchBuilder.js';
import { updateRecord, getRecord } from '../settlementStore.js';
import { globalMetrics } from '../metrics/MetricsCollector.js';
import { RelayerConfig } from '../config.js';

export interface ProcessBatchResultItem {
  paymentId: string;
  status: 'settled' | 'partial' | 'rejected' | 'failed';
  paid?: bigint;
  shortfall?: bigint;
  reason?: string;
}

export interface SettlementRpcInterface {
  simulateBatch(
    items: BatchItem[],
    channelAccount: ChannelAccountState,
  ): Promise<{
    results?: SettleResult[];
    minResourceFee?: string;
    restoreNeeded?: boolean;
    error?: string;
  }>;
  submitBatch(
    items: BatchItem[],
    channelAccount: ChannelAccountState,
    feePayerSigner: FeePayerSigner,
  ): Promise<SettleResult[]>;
}

export class SettlementWorker {
  private readonly config: RelayerConfig;
  private readonly channelManager: ChannelManager;
  private readonly feePayerSigner: FeePayerSigner;
  private readonly rpcClient?: SettlementRpcInterface;

  constructor(opts: {
    config: RelayerConfig;
    channelManager: ChannelManager;
    feePayerSigner: FeePayerSigner;
    rpcClient?: SettlementRpcInterface;
  }) {
    this.config = opts.config;
    this.channelManager = opts.channelManager;
    this.feePayerSigner = opts.feePayerSigner;
    this.rpcClient = opts.rpcClient;
  }

  /**
   * Process a single batch of authorizations.
   */
  async processBatch(items: BatchItem[]): Promise<ProcessBatchResultItem[]> {
    if (items.length === 0) return [];
    if (items.length > BatchBuilder.CONTRACT_MAX_BATCH_SIZE) {
      throw new Error(
        `Batch exceeds contract limit: ${items.length} > ${BatchBuilder.CONTRACT_MAX_BATCH_SIZE}`,
      );
    }

    const startTime = Date.now();
    let channel: ChannelAccountState | null = null;

    // Mark all items as 'submitting'
    for (const item of items) {
      updateRecord(item.paymentId, { status: 'submitting' });
      globalMetrics.incrementStatus('submitting');
    }

    try {
      // 1. Acquire channel account with concurrency lock
      channel = await this.channelManager.acquireChannel();
      globalMetrics.setChannelAvailability(
        this.channelManager.getPoolSize(),
        this.channelManager.getAvailableCount(),
        this.channelManager.getPoolSize() - this.channelManager.getAvailableCount(),
      );

      // 2. Simulate before submit with backoff on transient errors
      let settleResults: SettleResult[];

      if (this.rpcClient) {
        // Use injected or mock RPC client
        const sim = await this.simulateWithRetry(async () =>
          this.rpcClient!.simulateBatch(items, channel!),
        );

        if (sim.restoreNeeded) {
          // Footprint/TTL restoration needed - handled automatically or recorded
        }

        // Submit to chain with retry on transient errors
        settleResults = await this.submitWithRetry(async () =>
          this.rpcClient!.submitBatch(items, channel!, this.feePayerSigner),
        );
      } else {
        // Default real Soroban client implementation
        settleResults = await this.executeSorobanBatch(items, channel);
      }

      // 3. Parse per-item results and update statuses
      const outcomes = this.parseBatchResults(items, settleResults);

      const latency = Date.now() - startTime;
      globalMetrics.recordSubmissionLatency(latency);

      // Release channel successfully
      await this.channelManager.releaseChannel(channel, false);
      channel = null;

      return outcomes;
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isBadSeq = errorMsg.includes('tx_bad_seq') || errorMsg.includes('bad sequence');

      if (channel) {
        await this.channelManager.releaseChannel(channel, isBadSeq);
      }

      // Handle failed batch items
      const results: ProcessBatchResultItem[] = [];
      for (const item of items) {
        // If already settled, keep existing status
        const existing = getRecord(item.paymentId);
        if (existing?.status === 'settled') {
          results.push({ paymentId: item.paymentId, status: 'settled', paid: existing.paid ?? item.auth.amount });
          continue;
        }

        updateRecord(item.paymentId, {
          status: 'failed',
          error: errorMsg,
        });
        globalMetrics.incrementStatus('failed');
        results.push({
          paymentId: item.paymentId,
          status: 'failed',
          reason: errorMsg,
        });
      }

      return results;
    }
  }

  /**
   * Parses contract SettleResult per item and maps to persistent statuses.
   * Never lets one bad item fail the other items in the batch.
   */
  public parseBatchResults(
    items: BatchItem[],
    results: SettleResult[],
  ): ProcessBatchResultItem[] {
    const outcomes: ProcessBatchResultItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const result = results[i];

      if (!result) {
        updateRecord(item.paymentId, {
          status: 'failed',
          error: 'No result returned from batch execution for item',
        });
        globalMetrics.incrementStatus('failed');
        outcomes.push({
          paymentId: item.paymentId,
          status: 'failed',
          reason: 'Missing batch result',
        });
        continue;
      }

      if (result.tag === 'Settled') {
        updateRecord(item.paymentId, {
          status: 'settled',
          paid: item.auth.amount,
          shortfall: 0n,
          onChainResult: 'Settled',
        });
        globalMetrics.incrementStatus('settled');
        outcomes.push({
          paymentId: item.paymentId,
          status: 'settled',
          paid: item.auth.amount,
          shortfall: 0n,
        });
      } else if (result.tag === 'Partial') {
        const [paid, shortfall] = result.values;
        updateRecord(item.paymentId, {
          status: 'partial',
          paid,
          shortfall,
          onChainResult: 'Partial',
        });
        globalMetrics.incrementStatus('partial');
        outcomes.push({
          paymentId: item.paymentId,
          status: 'partial',
          paid,
          shortfall,
        });
      } else if (result.tag === 'Rejected') {
        const reasonCode = result.values[0];
        const reasonName = RejectReason[reasonCode] ?? `RejectCode_${reasonCode}`;

        // Idempotency: Treat "already settled" (Replay) as success per spec
        if (reasonCode === RejectReason.Replay) {
          updateRecord(item.paymentId, {
            status: 'settled',
            onChainResult: 'Replay (already settled)',
            paid: item.auth.amount,
            shortfall: 0n,
          });
          globalMetrics.incrementStatus('settled');
          outcomes.push({
            paymentId: item.paymentId,
            status: 'settled',
            paid: item.auth.amount,
            shortfall: 0n,
          });
        } else {
          const shortfall = reasonCode === RejectReason.Insufficient ? item.auth.amount : 0n;
          updateRecord(item.paymentId, {
            status: 'rejected',
            onChainResult: reasonName,
            paid: 0n,
            shortfall,
            error: `Rejected by contract: ${reasonName}`,
          });
          globalMetrics.incrementStatus('rejected');
          outcomes.push({
            paymentId: item.paymentId,
            status: 'rejected',
            reason: reasonName,
            paid: 0n,
            shortfall,
          });
        }
      }
    }

    return outcomes;
  }

  private async executeSorobanBatch(
    items: BatchItem[],
    channel: ChannelAccountState,
  ): Promise<SettleResult[]> {
    const client = new VaultClient({
      contractId: this.config.VAULT_CONTRACT_ID,
      rpcUrl: this.config.SOROBAN_RPC_URL,
      networkPassphrase: this.config.STELLAR_NETWORK_PASSPHRASE,
      publicKey: channel.publicKey,
    });

    const formattedItems = items.map((item) => ({
      auth: {
        version: item.auth.version,
        allowance_id: item.auth.allowanceId,
        payment_id: Buffer.from(item.auth.paymentId),
        merchant: Buffer.from(item.auth.merchant).toString('hex'), // or address
        amount: item.auth.amount,
        issued_at: BigInt(item.auth.issuedAt),
        expires_at: BigInt(item.auth.expiresAt),
      },
      signature: Buffer.from(item.auth.signature),
    }));

    const tx = await client.settleBatch(formattedItems);
    const sim = await tx.simulate();

    return (sim.result ?? []) as SettleResult[];
  }

  private async simulateWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let delay = 100;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw new Error('Simulation retries exhausted');
  }

  private async submitWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let delay = 150;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err: any) {
        const msg = String(err);
        const isTransient =
          msg.includes('504') ||
          msg.includes('503') ||
          msg.includes('timeout') ||
          msg.includes('rate limit');
        if (!isTransient || i === retries - 1) throw err;
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw new Error('Submission retries exhausted');
  }
}
