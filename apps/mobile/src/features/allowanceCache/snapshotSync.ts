import { ISnapshotRepository } from './snapshotRepository.js';
import { MerchantAllowanceSnapshot, SyncResult } from './types.js';

export interface SnapshotSyncHttpClient {
  fetchSnapshots(since: number): Promise<{
    snapshots: Array<{
      allowance_id: string;
      owner: string;
      balance_bucket: string;
      valid_until: number;
      age_seconds: number;
      shortfall_count: number;
      total_shortfall: string;
      status: string;
      snapshot_at: number;
      device_key_hex?: string;
    }>;
    count: number;
    synced_at: number;
  }>;
}

export class SnapshotSyncService {
  constructor(
    private readonly repo: ISnapshotRepository,
    private readonly httpClient?: SnapshotSyncHttpClient,
  ) {}

  /**
   * Performs bandwidth-conscious incremental sync using the `since` cursor.
   * If offline or fetch fails, catches error and returns gracefully without crashing.
   */
  async sync(indexerBaseUrl?: string): Promise<SyncResult> {
    const previousSyncedAt = await this.repo.getLastSyncedAt();

    let remoteData: {
      snapshots: any[];
      synced_at: number;
    };

    if (this.httpClient) {
      remoteData = await this.httpClient.fetchSnapshots(previousSyncedAt);
    } else {
      if (!indexerBaseUrl) {
        throw new Error('indexerBaseUrl or httpClient is required to sync snapshots');
      }
      const url = `${indexerBaseUrl}/v1/snapshots?since=${previousSyncedAt}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Snapshot sync failed with status ${res.status}`);
      }
      remoteData = await res.json();
    }

    const incoming: MerchantAllowanceSnapshot[] = remoteData.snapshots.map((s) => ({
      allowanceId: s.allowance_id,
      owner: s.owner,
      balanceBucket: s.balance_bucket,
      validUntil: s.valid_until,
      ageSeconds: s.age_seconds,
      shortfallCount: s.shortfall_count,
      totalShortfall: s.total_shortfall,
      status: s.status,
      lastSyncedAt: remoteData.synced_at,
      deviceKeyHex: s.device_key_hex,
    }));

    await this.repo.upsertSnapshots(incoming);
    await this.repo.setLastSyncedAt(remoteData.synced_at);

    return {
      syncedCount: incoming.length,
      syncedAt: remoteData.synced_at,
      previousSyncedAt,
    };
  }
}
