import { SettlementItem, formatUsdc } from './api.js';

export function convertToCsv(items: SettlementItem[]): string {
  const headers = [
    'Time (UTC)',
    'Payment ID',
    'Allowance ID',
    'Requested Amount',
    'Status',
    'Paid',
    'Shortfall',
    'On-Chain Result',
  ];

  const rows = items.map((item) => {
    const time = new Date(item.acceptedAt * 1000).toISOString();
    return [
      `"${time}"`,
      `"${item.paymentId}"`,
      `"${item.allowanceId}"`,
      `"${formatUsdc(item.amount)}"`,
      `"${item.status}"`,
      `"${formatUsdc(item.paid)}"`,
      `"${formatUsdc(item.shortfall)}"`,
      `"${item.onChainResult ?? ''}"`,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export function downloadCsv(csvContent: string, filename: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
