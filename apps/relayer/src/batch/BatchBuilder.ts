import { decodePaymentAuthorization, type PaymentAuthorization } from '@kasuwa/protocol';

export interface BatchItem {
  paymentId: string;
  rawBytesB64: string;
  auth: PaymentAuthorization;
}

export class BatchBuilder {
  /** Maximum items per batch allowed by the contract */
  public static readonly CONTRACT_MAX_BATCH_SIZE = 25;

  /**
   * Decodes and parses raw queued items, filtering out items that fail decoding.
   */
  static parseQueuedJobs(jobs: Array<{ paymentId: string; rawBytesB64: string }>): BatchItem[] {
    const items: BatchItem[] = [];
    for (const job of jobs) {
      try {
        const b64 = job.rawBytesB64.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const bytes = new Uint8Array(Buffer.from(padded, 'base64'));
        const auth = decodePaymentAuthorization(bytes);
        items.push({
          paymentId: job.paymentId,
          rawBytesB64: job.rawBytesB64,
          auth,
        });
      } catch {
        // Corrupt jobs in queue will not prevent valid jobs from batching
      }
    }
    return items;
  }

  /**
   * Groups items into batches respecting the contract max batch size (<= 25),
   * sorted by expiry proximity (items expiring soonest prioritized first).
   */
  static groupIntoBatches(
    items: BatchItem[],
    maxBatchSize: number = BatchBuilder.CONTRACT_MAX_BATCH_SIZE,
  ): BatchItem[][] {
    const effectiveMaxSize = Math.min(maxBatchSize, BatchBuilder.CONTRACT_MAX_BATCH_SIZE);

    if (items.length === 0) return [];

    // Sort by expiresAt ascending: closest expiry processed first
    const sorted = [...items].sort((a, b) => a.auth.expiresAt - b.auth.expiresAt);

    const batches: BatchItem[][] = [];
    for (let i = 0; i < sorted.length; i += effectiveMaxSize) {
      batches.push(sorted.slice(i, i + effectiveMaxSize));
    }

    return batches;
  }
}
