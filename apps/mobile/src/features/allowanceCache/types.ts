export interface MerchantAllowanceSnapshot {
  allowanceId: string;
  owner: string;
  balanceBucket: string;
  validUntil: number;
  ageSeconds: number;
  shortfallCount: number;
  totalShortfall: string;
  status: string;
  lastSyncedAt: number;
  deviceKeyHex?: string;
}

export interface SyncResult {
  syncedCount: number;
  syncedAt: number;
  previousSyncedAt: number;
}
