export interface RelayerMetricsSnapshot {
  queueDepth: number;
  submissionLatencyMs: {
    last: number;
    avg: number;
    min: number;
    max: number;
  };
  perStatusCounts: {
    accepted: number;
    submitting: number;
    settled: number;
    partial: number;
    rejected: number;
    failed: number;
  };
  feePayerBalanceStroops: bigint;
  channelAvailability: {
    total: number;
    available: number;
    busy: number;
  };
}

export class MetricsCollector {
  private queueDepth = 0;
  private submissionLatencies: number[] = [];
  private perStatusCounts = {
    accepted: 0,
    submitting: 0,
    settled: 0,
    partial: 0,
    rejected: 0,
    failed: 0,
  };
  private feePayerBalanceStroops = 0n;
  private channelAvailability = {
    total: 0,
    available: 0,
    busy: 0,
  };

  setQueueDepth(depth: number): void {
    this.queueDepth = Math.max(0, depth);
  }

  recordSubmissionLatency(latencyMs: number): void {
    this.submissionLatencies.push(latencyMs);
    // Keep last 100 observations to bound memory
    if (this.submissionLatencies.length > 100) {
      this.submissionLatencies.shift();
    }
  }

  incrementStatus(status: keyof typeof this.perStatusCounts, count: number = 1): void {
    this.perStatusCounts[status] = (this.perStatusCounts[status] || 0) + count;
  }

  setFeePayerBalance(balanceStroops: bigint): void {
    this.feePayerBalanceStroops = balanceStroops;
  }

  setChannelAvailability(total: number, available: number, busy: number): void {
    this.channelAvailability = { total, available, busy };
  }

  getSnapshot(): RelayerMetricsSnapshot {
    const lats = this.submissionLatencies;
    const last = lats.length > 0 ? lats[lats.length - 1]! : 0;
    const min = lats.length > 0 ? Math.min(...lats) : 0;
    const max = lats.length > 0 ? Math.max(...lats) : 0;
    const avg = lats.length > 0 ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : 0;

    return {
      queueDepth: this.queueDepth,
      submissionLatencyMs: { last, avg, min, max },
      perStatusCounts: { ...this.perStatusCounts },
      feePayerBalanceStroops: this.feePayerBalanceStroops,
      channelAvailability: { ...this.channelAvailability },
    };
  }

  toPrometheusFormat(): string {
    const s = this.getSnapshot();
    return [
      `# HELP relayer_queue_depth Current pending settlement queue depth`,
      `# TYPE relayer_queue_depth gauge`,
      `relayer_queue_depth ${s.queueDepth}`,
      `# HELP relayer_submission_latency_ms Settlement transaction submission latency in milliseconds`,
      `# TYPE relayer_submission_latency_ms gauge`,
      `relayer_submission_latency_ms{stat="last"} ${s.submissionLatencyMs.last}`,
      `relayer_submission_latency_ms{stat="avg"} ${s.submissionLatencyMs.avg}`,
      `relayer_submission_latency_ms{stat="min"} ${s.submissionLatencyMs.min}`,
      `relayer_submission_latency_ms{stat="max"} ${s.submissionLatencyMs.max}`,
      `# HELP relayer_settlements_total Count of processed settlement authorizations by status`,
      `# TYPE relayer_settlements_total counter`,
      `relayer_settlements_total{status="settled"} ${s.perStatusCounts.settled}`,
      `relayer_settlements_total{status="partial"} ${s.perStatusCounts.partial}`,
      `relayer_settlements_total{status="rejected"} ${s.perStatusCounts.rejected}`,
      `relayer_settlements_total{status="submitting"} ${s.perStatusCounts.submitting}`,
      `relayer_settlements_total{status="failed"} ${s.perStatusCounts.failed}`,
      `# HELP relayer_fee_payer_balance_stroops Current balance of relayer fee payer in stroops`,
      `# TYPE relayer_fee_payer_balance_stroops gauge`,
      `relayer_fee_payer_balance_stroops ${s.feePayerBalanceStroops.toString()}`,
      `# HELP relayer_channel_accounts Channel accounts availability`,
      `# TYPE relayer_channel_accounts gauge`,
      `relayer_channel_accounts{state="total"} ${s.channelAvailability.total}`,
      `relayer_channel_accounts{state="available"} ${s.channelAvailability.available}`,
      `relayer_channel_accounts{state="busy"} ${s.channelAvailability.busy}`,
    ].join('\n');
  }
}

export const globalMetrics = new MetricsCollector();
