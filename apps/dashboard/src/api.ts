export interface SettlementItem {
  paymentId: string;
  allowanceId: string;
  merchant: string;
  amount: string;
  expiresAt: number;
  status: 'accepted' | 'submitting' | 'settled' | 'partial' | 'rejected' | 'failed';
  paid?: string | null;
  shortfall?: string | null;
  onChainResult?: string | null;
  acceptedAt: number;
  updatedAt: number;
}

export interface MerchantSettlementResponse {
  merchant: string;
  settlements: SettlementItem[];
  total: number;
}

export interface SettlementSummary {
  totalSettledBaseUnits: bigint;
  totalSettledFormatted: string;
  pendingCount: number;
  rejectedCount: number;
  totalCount: number;
}

export function formatUsdc(baseUnits?: string | bigint | null): string {
  if (baseUnits === undefined || baseUnits === null) return '0.00';
  const b = BigInt(baseUnits);
  const units = b / 10_000_000n;
  const decimals = (b % 10_000_000n).toString().padStart(7, '0').slice(0, 2);
  return `${units}.${decimals} USDC`;
}

export function computeSummary(items: SettlementItem[]): SettlementSummary {
  let settledTotal = 0n;
  let pending = 0;
  let rejected = 0;

  for (const item of items) {
    if (item.status === 'settled' || item.status === 'partial') {
      settledTotal += BigInt(item.paid || '0');
    }
    if (item.status === 'accepted' || item.status === 'submitting') {
      pending++;
    }
    if (item.status === 'rejected' || item.status === 'failed') {
      rejected++;
    }
  }

  return {
    totalSettledBaseUnits: settledTotal,
    totalSettledFormatted: formatUsdc(settledTotal),
    pendingCount: pending,
    rejectedCount: rejected,
    totalCount: items.length,
  };
}

export async function fetchMerchantSettlements(
  merchantAddress: string,
  indexerUrl = 'http://localhost:3002',
): Promise<MerchantSettlementResponse> {
  const cleanAddress = merchantAddress.trim();
  if (!cleanAddress) {
    return { merchant: '', settlements: [], total: 0 };
  }

  const res = await fetch(`${indexerUrl}/v1/merchants/${cleanAddress}/settlements?limit=100`);
  if (!res.ok) {
    throw new Error(`Failed to load settlements for merchant: HTTP ${res.status}`);
  }

  return res.json();
}
