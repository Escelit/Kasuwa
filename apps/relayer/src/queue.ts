import { Queue } from 'bullmq';
import { loadConfig } from './config.js';
import { globalMetrics } from './metrics/MetricsCollector.js';

export interface SettlementJob {
  paymentId: string;
  rawBytesB64: string;
}

let bullQueue: Queue<SettlementJob> | null = null;
const inMemoryQueue: SettlementJob[] = [];

/**
 * Returns or initializes the BullMQ Queue instance.
 */
export function getQueue(): Queue<SettlementJob> | null {
  const config = loadConfig();
  if (config.NODE_ENV === 'test') {
    return null; // Use in-memory queue in unit tests
  }

  if (!bullQueue && config.REDIS_URL) {
    try {
      bullQueue = new Queue<SettlementJob>('settlements', {
        connection: {
          url: config.REDIS_URL,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });
    } catch {
      bullQueue = null;
    }
  }

  return bullQueue;
}

/**
 * Enqueues a settlement job into BullMQ (or in-memory if in test/fallback).
 */
export async function enqueueSettlement(job: SettlementJob): Promise<void> {
  const queue = getQueue();
  if (queue) {
    await queue.add('settle', job, {
      jobId: job.paymentId,
    });
    const count = await queue.getWaitingCount();
    globalMetrics.setQueueDepth(count);
  } else {
    inMemoryQueue.push(job);
    globalMetrics.setQueueDepth(inMemoryQueue.length);
  }
}

/** For tests: inspect queue */
export function _getQueuedJobs(): SettlementJob[] {
  return [...inMemoryQueue];
}

/** For tests: clear queue */
export function _clearQueue(): void {
  inMemoryQueue.length = 0;
  globalMetrics.setQueueDepth(0);
}
