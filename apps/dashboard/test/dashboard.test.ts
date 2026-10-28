import { describe, it, expect } from 'vitest';
import { formatUsdc, computeSummary, SettlementItem } from '../src/api.js';
import { convertToCsv } from '../src/exportCsv.js';

const mockSettlements: SettlementItem[] = [
  {
    paymentId: 'pay-001-aaaa',
    allowanceId: '1',
    merchant: 'GMERCHANT_AAA',
    amount: '15000000', // 15 USDC
    expiresAt: 1700100000,
    status: 'settled',
    paid: '15000000',
    shortfall: '0',
    onChainResult: 'Settled',
    acceptedAt: 1700001000,
    updatedAt: 1700001010,
  },
  {
    paymentId: 'pay-002-bbbb',
    allowanceId: '1',
    merchant: 'GMERCHANT_AAA',
    amount: '15000000', // 15 USDC
    expiresAt: 1700100000,
    status: 'partial',
    paid: '5000000', // 5 USDC paid
    shortfall: '10000000', // 10 USDC shortfall
    onChainResult: 'Partial',
    acceptedAt: 1700002000,
    updatedAt: 1700002010,
  },
  {
    paymentId: 'pay-003-cccc',
    allowanceId: '2',
    merchant: 'GMERCHANT_AAA',
    amount: '10000000',
    expiresAt: 1700100000,
    status: 'submitting',
    acceptedAt: 1700003000,
    updatedAt: 1700003010,
  },
  {
    paymentId: 'pay-004-dddd',
    allowanceId: '3',
    merchant: 'GMERCHANT_AAA',
    amount: '10000000',
    expiresAt: 1700100000,
    status: 'rejected',
    paid: '0',
    shortfall: '10000000',
    onChainResult: 'OverCap',
    acceptedAt: 1700004000,
    updatedAt: 1700004010,
  },
];

describe('apps/dashboard - Reconciliation Logic & Metrics', () => {
  it('formats base units into human-readable USDC strings', () => {
    expect(formatUsdc('15000000')).toBe('1.50 USDC');
    expect(formatUsdc(50_000_000n)).toBe('5.00 USDC');
    expect(formatUsdc(0n)).toBe('0.00 USDC');
    expect(formatUsdc(null)).toBe('0.00');
  });

  it('computes summary cards: total settled, pending count, and rejected count', () => {
    const summary = computeSummary(mockSettlements);

    // Settled total: 15M + 5M = 20M base units (2.00 USDC)
    expect(summary.totalSettledBaseUnits).toBe(20_000_000n);
    expect(summary.totalSettledFormatted).toBe('2.00 USDC');
    // Pending: 1 ('submitting')
    expect(summary.pendingCount).toBe(1);
    // Rejected: 1 ('rejected')
    expect(summary.rejectedCount).toBe(1);
    expect(summary.totalCount).toBe(4);
  });

  it('generates standard CSV with headers and formatted values for reconciliation export', () => {
    const csv = convertToCsv(mockSettlements);
    expect(csv).toContain('Time (UTC),Payment ID,Allowance ID,Requested Amount,Status,Paid,Shortfall,On-Chain Result');
    expect(csv).toContain('"pay-001-aaaa"');
    expect(csv).toContain('"settled"');
    expect(csv).toContain('"partial"');
    expect(csv).toContain('"rejected"');
    expect(csv).toContain('"OverCap"');
  });
});
