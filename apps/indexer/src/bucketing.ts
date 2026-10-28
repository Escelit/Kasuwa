/**
 * Coarse balance bucketing for merchant risk cache snapshots.
 *
 * Exposing exact allowance balances leaks customer transaction history and current
 * financial state to every merchant counter they visit.
 * Bucketing preserves customer privacy while supplying merchants with sufficient
 * confidence bounds to evaluate offline risk tiers.
 */
export type BalanceBucket = '0' | '1-10' | '10-50' | '50-200' | '200+';

export function computeBalanceBucket(balanceBaseUnits: bigint | string | number): BalanceBucket {
  const b = BigInt(balanceBaseUnits);

  if (b <= 0n) {
    return '0';
  }
  if (b <= 10_000_000n) {
    return '1-10';
  }
  if (b <= 50_000_000n) {
    return '10-50';
  }
  if (b <= 200_000_000n) {
    return '50-200';
  }
  return '200+';
}
