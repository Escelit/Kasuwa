/**
 * Local spend counter for a single allowance.
 *
 * Tracks how many tokens have been committed to offline authorizations
 * that have not yet settled. This is a SAFETY NET against accidental
 * over-issuing; it does NOT prevent fraud or double-spend
 * (a determined attacker can ignore it).
 *
 * The UI must never claim this counter prevents fraud.
 */
export interface SpendCounterState {
  allowanceId: string;
  cachedBalance: bigint;
  perPaymentCap: bigint;
  localSpent: bigint;
}

export type SpendCounterAction =
  | { type: 'COMMIT'; amount: bigint }
  | { type: 'RELEASE'; amount: bigint }      // authorization expired or failed
  | { type: 'SETTLE'; amount: bigint }       // settled on-chain
  | { type: 'SYNC_BALANCE'; balance: bigint };

/**
 * Pure reducer for the local spend counter. No I/O.
 * Throws on illegal transitions.
 */
export function spendCounterReducer(
  state: SpendCounterState,
  action: SpendCounterAction,
): SpendCounterState {
  switch (action.type) {
    case 'COMMIT': {
      if (action.amount <= 0n) {
        throw new Error(`COMMIT: amount must be positive, got ${action.amount}`);
      }
      if (action.amount > state.perPaymentCap) {
        throw new Error(
          `COMMIT: amount ${action.amount} exceeds per_payment_cap ${state.perPaymentCap}`,
        );
      }
      const available = state.cachedBalance - state.localSpent;
      if (action.amount > available) {
        throw new Error(
          `COMMIT: amount ${action.amount} exceeds available balance ${available}`,
        );
      }
      return { ...state, localSpent: state.localSpent + action.amount };
    }

    case 'RELEASE': {
      if (action.amount <= 0n) {
        throw new Error(`RELEASE: amount must be positive, got ${action.amount}`);
      }
      const newSpent = state.localSpent - action.amount;
      if (newSpent < 0n) {
        throw new Error(
          `RELEASE: would make localSpent negative (${newSpent})`,
        );
      }
      return { ...state, localSpent: newSpent };
    }

    case 'SETTLE': {
      // Settled: actual balance decreased, so we reduce both cachedBalance and localSpent
      if (action.amount <= 0n) {
        throw new Error(`SETTLE: amount must be positive, got ${action.amount}`);
      }
      return {
        ...state,
        cachedBalance: state.cachedBalance - action.amount,
        localSpent: state.localSpent > action.amount
          ? state.localSpent - action.amount
          : 0n,
      };
    }

    case 'SYNC_BALANCE': {
      // Fresh on-chain balance arrived; reset cachedBalance, keep localSpent
      return { ...state, cachedBalance: action.balance };
    }

    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Returns the effective available balance (cached minus locally committed).
 * This is an estimate — not a guarantee.
 */
export function availableBalance(state: SpendCounterState): bigint {
  const avail = state.cachedBalance - state.localSpent;
  return avail < 0n ? 0n : avail;
}

/**
 * Returns whether issuing a new payment of `amount` is locally permissible.
 * Returns an error reason or null (= allowed).
 */
export function checkCanIssue(
  state: SpendCounterState,
  amount: bigint,
): string | null {
  if (amount <= 0n) return 'Amount must be positive';
  if (amount > state.perPaymentCap) {
    return `Amount exceeds per-payment cap of ${state.perPaymentCap}`;
  }
  const available = availableBalance(state);
  if (amount > available) {
    return `Estimated available balance (${available}) is less than requested amount (${amount})`;
  }
  return null;
}
