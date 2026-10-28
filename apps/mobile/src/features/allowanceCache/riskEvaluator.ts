import {
  assessRisk,
  DEFAULT_RISK_POLICY,
  RiskAssessment,
  RiskPolicy,
  UnsettledExposure,
} from '@kasuwa/risk';
import { ISnapshotRepository } from './snapshotRepository.js';
import { MerchantAllowanceSnapshot } from './types.js';

export interface CounterRiskEvaluation {
  assessment: RiskAssessment;
  snapshotAgeSeconds: number | null;
  snapshotAgeFormatted: string;
  isStale: boolean;
  needsExplicitConfirmation: boolean;
  allowanceFound: boolean;
  snapshot: MerchantAllowanceSnapshot | null;
}

export function formatSnapshotAge(seconds: number | null): string {
  if (seconds === null) return 'Never synced (Unknown allowance)';
  if (seconds < 60) return 'Just now (< 1 min)';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export class CounterRiskEvaluator {
  constructor(
    private readonly repo: ISnapshotRepository,
    private readonly policy: RiskPolicy = DEFAULT_RISK_POLICY,
  ) {}

  /**
   * Pure counter risk evaluation running strictly offline with no network calls.
   */
  async evaluatePayment(opts: {
    allowanceId: string;
    requestedAmount: bigint;
    unsettledExposure?: UnsettledExposure;
    nowSeconds?: number;
  }): Promise<CounterRiskEvaluation> {
    const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    const snapshot = await this.repo.getSnapshot(opts.allowanceId);

    const exposure: UnsettledExposure = opts.unsettledExposure ?? {
      totalUnsettled: 0n,
      count: 0,
    };

    let snapshotAgeSeconds: number | null = null;
    let isStale = false;

    // Convert to packages/risk AllowanceSnapshot shape
    let riskEngineSnapshot = null;
    if (snapshot) {
      snapshotAgeSeconds = Math.max(0, now - snapshot.lastSyncedAt);
      isStale =
        this.policy.maxSnapshotStalenessSeconds > 0 &&
        snapshotAgeSeconds > this.policy.maxSnapshotStalenessSeconds;

      riskEngineSnapshot = {
        allowanceId: snapshot.allowanceId,
        owner: snapshot.owner,
        totalSize: 50_000_000n, // Estimated baseline
        ageSeconds: snapshot.ageSeconds,
        shortfallCount: snapshot.shortfallCount,
        totalShortfall: BigInt(snapshot.totalShortfall || '0'),
        snapshotTimestampSeconds: snapshot.lastSyncedAt,
      };
    }

    const assessment = assessRisk(
      riskEngineSnapshot,
      this.policy,
      exposure,
      opts.requestedAmount,
      now,
    );

    // If stale, augment reasons
    if (isStale && !assessment.reasons.some((r) => r.includes('stale'))) {
      assessment.reasons.unshift(
        `Snapshot is stale (${formatSnapshotAge(snapshotAgeSeconds)}). Risk downgraded.`,
      );
      if (assessment.level === 'green') {
        assessment.level = 'amber';
      }
    }

    // Explicit confirmation required for any amber or red risk, or unknown allowance
    const needsExplicitConfirmation =
      assessment.level === 'amber' || assessment.level === 'red' || !snapshot;

    return {
      assessment,
      snapshotAgeSeconds,
      snapshotAgeFormatted: formatSnapshotAge(snapshotAgeSeconds),
      isStale,
      needsExplicitConfirmation,
      allowanceFound: snapshot !== null,
      snapshot,
    };
  }
}
