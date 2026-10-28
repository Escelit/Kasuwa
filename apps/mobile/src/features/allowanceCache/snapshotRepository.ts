import { MerchantAllowanceSnapshot } from './types.js';

export interface ISnapshotRepository {
  getSnapshot(allowanceId: string): Promise<MerchantAllowanceSnapshot | null>;
  upsertSnapshots(snapshots: MerchantAllowanceSnapshot[]): Promise<number>;
  getLastSyncedAt(): Promise<number>;
  setLastSyncedAt(ts: number): Promise<void>;
  getAllSnapshots(): Promise<MerchantAllowanceSnapshot[]>;
}

/**
 * In-memory snapshot repository for fast unit tests and environments without native SQLite.
 */
export class InMemorySnapshotRepository implements ISnapshotRepository {
  private snapshots = new Map<string, MerchantAllowanceSnapshot>();
  private lastSyncedAt = 0;

  async getSnapshot(allowanceId: string): Promise<MerchantAllowanceSnapshot | null> {
    const s = this.snapshots.get(allowanceId);
    return s ? { ...s } : null;
  }

  async upsertSnapshots(incoming: MerchantAllowanceSnapshot[]): Promise<number> {
    for (const snap of incoming) {
      this.snapshots.set(snap.allowanceId, { ...snap });
    }
    return incoming.length;
  }

  async getLastSyncedAt(): Promise<number> {
    return this.lastSyncedAt;
  }

  async setLastSyncedAt(ts: number): Promise<void> {
    this.lastSyncedAt = ts;
  }

  async getAllSnapshots(): Promise<MerchantAllowanceSnapshot[]> {
    return Array.from(this.snapshots.values());
  }

  clear() {
    this.snapshots.clear();
    this.lastSyncedAt = 0;
  }
}
