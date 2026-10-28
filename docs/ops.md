# Relayer Operations, Observability & Alerting

This document outlines the operational monitoring, telemetry metrics, and alerting thresholds for the Kasuwa settlement relayer.

---

## 1. Relayer Telemetry Metrics

The relayer tracks and exposes Prometheus-compatible metrics for settlement pipelines:

| Metric Name | Type | Description |
|---|---|---|
| `relayer_queue_depth` | Gauge | Number of signed payment authorizations waiting in the settlement queue. |
| `relayer_submission_latency_ms` | Gauge | Latency (in ms) of transaction simulation, signing, and submission to Soroban RPC. Tags: `stat="last"`, `avg`, `min`, `max`. |
| `relayer_settlements_total` | Counter | Total authorizations processed by the relayer partitioned by `status`: `settled`, `partial`, `rejected`, `submitting`, `failed`. |
| `relayer_fee_payer_balance_stroops` | Gauge | Sponsoring account XLM balance in stroops (1 XLM = 10,000,000 stroops). |
| `relayer_channel_accounts` | Gauge | Number of channel accounts by `state`: `total`, `available`, `busy`. |

---

## 2. Recommended Operational Alerts

### 🚨 Critical Severity

1. **RelayerFeePayerBalanceLow**
   - **Condition**: `relayer_fee_payer_balance_stroops < 1000000000` (< 100 XLM).
   - **Impact**: Fee-bump sponsorship will fail; merchants cannot settle without XLM.
   - **Remediation**: Top up the relayer fee-payer account from operational treasury.

2. **ChannelAccountExhaustion**
   - **Condition**: `relayer_channel_accounts{state="available"} == 0` for > 60 seconds.
   - **Impact**: Batch submission stalls; queue backlog increases.
   - **Remediation**: Increase `RELAYER_CHANNEL_ACCOUNTS` or investigate stuck RPC submissions.

3. **HighSettlementFailureRate**
   - **Condition**: `rate(relayer_settlements_total{status="failed"}[5m]) > 0.05` (> 5% RPC errors).
   - **Impact**: Network partition, invalid sequence errors, or Soroban RPC node instability.
   - **Remediation**: Check Soroban RPC connectivity and sequence resynchronization.

### ⚠️ Warning Severity

1. **QueueBacklogHigh**
   - **Condition**: `relayer_queue_depth > 500` for > 5 minutes.
   - **Impact**: Settlements delayed; authorizations risk approaching expiration (`expires_at`).
   - **Remediation**: Scale worker consumers or increase channel account pool.

2. **HighSubmissionLatency**
   - **Condition**: `relayer_submission_latency_ms{stat="avg"} > 15000` (> 15 seconds).
   - **Impact**: Soroban network congestion or RPC latency degradation.
   - **Remediation**: Check RPC response times and adjust backoff timeouts.

---

## 3. Channel Account Sequence Runbook

If a channel account encounters a sequence collision (`tx_bad_seq`):
1. `ChannelManager.releaseChannel(channel, true)` automatically resynchronizes sequence numbers from the RPC.
2. In manual recovery scenarios, reload account sequences via `/healthz` or restart the relayer process.
