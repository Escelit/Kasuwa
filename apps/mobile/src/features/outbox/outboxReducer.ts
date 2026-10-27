/**
 * Outbox state machine reducer.
 *
 * States: queued → submitting → settled | partial | rejected | expired | failed_retry
 * Transitions are explicit and exhaustive. Illegal transitions throw.
 *
 * Pure reducer — no I/O.
 */

export type OutboxStatus =
  | 'queued'
  | 'submitting'
  | 'settled'
  | 'partial'
  | 'rejected'
  | 'expired'
  | 'failed_retry';

export interface OutboxEntry {
  id?: number;
  paymentId: string;
  allowanceId: string;
  rawBytes: Uint8Array;
  amount: bigint;
  merchant: string;
  expiresAt: number;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  resultCode: string | null;
  paid: bigint | null;
  shortfall: bigint | null;
  createdAt: number;
  updatedAt: number;
}

export type OutboxAction =
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_SUCCESS'; resultCode: string; paid: bigint; shortfall: bigint }
  | { type: 'SUBMIT_FAILURE'; error: string }
  | { type: 'MARK_EXPIRED' }
  | { type: 'RESET_TO_QUEUED' };

/** Allowed transitions: from → allowed next statuses */
const ALLOWED: Record<OutboxStatus, Set<OutboxStatus>> = {
  queued:       new Set<OutboxStatus>(['submitting', 'expired']),
  submitting:   new Set<OutboxStatus>(['settled', 'partial', 'rejected', 'failed_retry', 'expired']),
  failed_retry: new Set<OutboxStatus>(['queued', 'expired']),
  settled:      new Set<OutboxStatus>(),
  partial:      new Set<OutboxStatus>(),
  rejected:     new Set<OutboxStatus>(),
  expired:      new Set<OutboxStatus>(),
};

function assertTransition(from: OutboxStatus, to: OutboxStatus): void {
  if (!ALLOWED[from].has(to)) {
    throw new Error(
      `Illegal outbox transition: ${from} → ${to}. ` +
        `Allowed from ${from}: [${[...ALLOWED[from]].join(', ')}]`,
    );
  }
}

export function outboxReducer(entry: OutboxEntry, action: OutboxAction): OutboxEntry {
  const now = Math.floor(Date.now() / 1000);
  switch (action.type) {
    case 'SUBMIT_START': {
      assertTransition(entry.status, 'submitting');
      return { ...entry, status: 'submitting', attempts: entry.attempts + 1, updatedAt: now };
    }
    case 'SUBMIT_SUCCESS': {
      let next: OutboxStatus;
      if (action.resultCode === 'Settled') next = 'settled';
      else if (action.resultCode.startsWith('Partial')) next = 'partial';
      else next = 'rejected';
      assertTransition(entry.status, next);
      return {
        ...entry,
        status: next,
        resultCode: action.resultCode,
        paid: action.paid,
        shortfall: action.shortfall,
        lastError: null,
        updatedAt: now,
      };
    }
    case 'SUBMIT_FAILURE': {
      assertTransition(entry.status, 'failed_retry');
      return { ...entry, status: 'failed_retry', lastError: action.error, updatedAt: now };
    }
    case 'MARK_EXPIRED': {
      assertTransition(entry.status, 'expired');
      return {
        ...entry,
        status: 'expired',
        lastError: 'Authorization expired before settlement',
        updatedAt: now,
      };
    }
    case 'RESET_TO_QUEUED': {
      assertTransition(entry.status, 'queued');
      return { ...entry, status: 'queued', lastError: null, updatedAt: now };
    }
    default: {
      const _x: never = action;
      throw new Error(`Unknown outbox action: ${JSON.stringify(_x)}`);
    }
  }
}

export function isTerminal(status: OutboxStatus): boolean {
  return ALLOWED[status].size === 0;
}

export function isExpired(entry: OutboxEntry, nowSeconds?: number): boolean {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  return entry.expiresAt <= now;
}
