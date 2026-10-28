import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySnapshotRepository } from '../snapshotRepository.js';
import { SnapshotSyncService, SnapshotSyncHttpClient } from '../snapshotSync.js';
import { CounterRiskEvaluator, formatSnapshotAge } from '../riskEvaluator.js';
import { DEFAULT_RISK_POLICY, RiskPolicy } from '@kasuwa/risk';

describe('apps/mobile - Allowance Cache Sync & Counter Risk Engine', () => {
  let repo: InMemorySnapshotRepository;

  beforeEach(() => {
    repo = new InMemorySnapshotRepository();
  });

  describe('Sync Merge Logic & Incremental Cursor', () => {
    it('performs initial sync and updates lastSyncedAt', async () => {
      const mockHttpClient: SnapshotSyncHttpClient = {
        fetchSnapshots: async (since) => {
          expect(since).toBe(0);
          return {
            snapshots: [
              {
                allowance_id: '101',
                owner: 'GOWNER101',
                balance_bucket: '10-50',
                valid_until: 1700600000,
                age_seconds: 3600,
                shortfall_count: 0,
                total_shortfall: '0',
                status: 'Active',
                snapshot_at: 1700100000,
              },
            ],
            count: 1,
            synced_at: 1700100000,
          };
        },
      };

      const syncService = new SnapshotSyncService(repo, mockHttpClient);
      const result = await syncService.sync();

      expect(result.syncedCount).toBe(1);
      expect(result.syncedAt).toBe(1700100000);
      expect(await repo.getLastSyncedAt()).toBe(1700100000);

      const cached = await repo.getSnapshot('101');
      expect(cached).not.toBeNull();
      expect(cached?.balanceBucket).toBe('10-50');
    });

    it('uses incremental `since` cursor on subsequent syncs to conserve bandwidth', async () => {
      await repo.setLastSyncedAt(1700100000);

      let requestedSince = -1;
      const mockHttpClient: SnapshotSyncHttpClient = {
        fetchSnapshots: async (since) => {
          requestedSince = since;
          return {
            snapshots: [
              {
                allowance_id: '102',
                owner: 'GOWNER102',
                balance_bucket: '50-200',
                valid_until: 1700600000,
                age_seconds: 7200,
                shortfall_count: 0,
                total_shortfall: '0',
                status: 'Active',
                snapshot_at: 1700200000,
              },
            ],
            count: 1,
            synced_at: 1700200000,
          };
        },
      };

      const syncService = new SnapshotSyncService(repo, mockHttpClient);
      await syncService.sync();

      // Incremental since cursor sent
      expect(requestedSince).toBe(1700100000);
      expect(await repo.getLastSyncedAt()).toBe(1700200000);

      // Both snapshots exist
      expect(await repo.getSnapshot('102')).not.toBeNull();
    });
  });

  describe('Stale Snapshot Risk Downgrade', () => {
    it('downgrades risk when snapshot exceeds maxSnapshotStalenessSeconds and displays age prominently', async () => {
      const now = 1700300000;
      const staleSyncedAt = now - 90000; // 25 hours ago (> 24 hours stale limit)

      await repo.upsertSnapshots([
        {
          allowanceId: '201',
          owner: 'GOWNER201',
          balanceBucket: '50-200',
          validUntil: now + 86400,
          ageSeconds: 100000,
          shortfallCount: 0,
          totalShortfall: '0',
          status: 'Active',
          lastSyncedAt: staleSyncedAt,
        },
      ]);

      const policy: RiskPolicy = {
        ...DEFAULT_RISK_POLICY,
        maxSnapshotStalenessSeconds: 86400, // 24 hours
      };

      const evaluator = new CounterRiskEvaluator(repo, policy);
      const evalResult = await evaluator.evaluatePayment({
        allowanceId: '201',
        requestedAmount: 5_000_000n, // 5 USDC
        nowSeconds: now,
      });

      expect(evalResult.isStale).toBe(true);
      expect(evalResult.snapshotAgeFormatted).toMatch(/1d ago|25h/);
      expect(evalResult.needsExplicitConfirmation).toBe(true);
      expect(evalResult.assessment.level).not.toBe('green');
      expect(evalResult.assessment.reasons.some((r) => r.includes('stale'))).toBe(true);
    });
  });

  describe('Airplane-Mode Counter Flow with Empty Cache', () => {
    it('operates fully offline without network: unknown allowance yields amber/red with explicit confirmation', async () => {
      // Empty cache (simulating fresh airplane-mode merchant device)
      const evaluator = new CounterRiskEvaluator(repo, DEFAULT_RISK_POLICY);

      const evalResult = await evaluator.evaluatePayment({
        allowanceId: 'unknown-999',
        requestedAmount: 10_000_000n, // 10 USDC
        nowSeconds: 1700000000,
      });

      expect(evalResult.allowanceFound).toBe(false);
      expect(evalResult.snapshot).toBeNull();
      expect(evalResult.snapshotAgeFormatted).toContain('Never synced');
      // Must require explicit merchant confirmation
      expect(evalResult.needsExplicitConfirmation).toBe(true);
      expect(evalResult.assessment.level).toMatch(/amber|red/);
      expect(evalResult.assessment.reasons.some((r) => r.toLowerCase().includes('unknown'))).toBe(true);
    });
  });

  describe('formatSnapshotAge helper', () => {
    it('formats ages cleanly for POS counter display', () => {
      expect(formatSnapshotAge(null)).toBe('Never synced (Unknown allowance)');
      expect(formatSnapshotAge(30)).toBe('Just now (< 1 min)');
      expect(formatSnapshotAge(150)).toBe('2 min ago');
      expect(formatSnapshotAge(7200)).toBe('2h ago');
      expect(formatSnapshotAge(172800)).toBe('2d ago');
    });
  });
});
