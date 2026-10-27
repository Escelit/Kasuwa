/**
 * BullMQ queue stub for Commit 7.
 *
 * Real BullMQ connection is wired in Commit 8 (chain submission).
 * For now this provides the same interface so routes don't need to change.
 */

export interface SettlementJob {
  paymentId: string;
  rawBytesB64: string;
}

// In-memory queue (for tests and Commit 7 stub)
const jobQueue: SettlementJob[] = [];

export async function enqueueSettlement(job: SettlementJob): Promise<void> {
  // In Commit 8 this becomes: await queue.add('settle', job, { jobId: job.paymentId, ... })
  jobQueue.push(job);
}

/** For tests: inspect the queue */
export function _getQueuedJobs(): SettlementJob[] {
  return [...jobQueue];
}

/** For tests: clear */
export function _clearQueue(): void {
  jobQueue.length = 0;
}
