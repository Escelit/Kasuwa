'use client';

import React, { useState, useMemo } from 'react';
import {
  SettlementItem,
  formatUsdc,
  computeSummary,
  fetchMerchantSettlements,
} from '../src/api.js';
import { convertToCsv, downloadCsv } from '../src/exportCsv.js';

export default function MerchantReconciliationPage() {
  const [addressInput, setAddressInput] = useState('');
  const [activeAddress, setActiveAddress] = useState('');
  const [settlements, setSettlements] = useState<SettlementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const handleLookup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = addressInput.trim();
    if (!query) return;

    setLoading(true);
    setError(null);
    try {
      const data = await fetchMerchantSettlements(query);
      setSettlements(data.settlements || []);
      setActiveAddress(query);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : String(err));
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredSettlements = useMemo(() => {
    return settlements.filter((item) => {
      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'pending' && item.status !== 'accepted' && item.status !== 'submitting') {
          return false;
        } else if (statusFilter !== 'pending' && item.status !== statusFilter) {
          return false;
        }
      }

      // Date range filter
      if (startDate) {
        const itemDate = new Date(item.acceptedAt * 1000).toISOString().slice(0, 10);
        if (itemDate < startDate) return false;
      }
      if (endDate) {
        const itemDate = new Date(item.acceptedAt * 1000).toISOString().slice(0, 10);
        if (itemDate > endDate) return false;
      }

      return true;
    });
  }, [settlements, statusFilter, startDate, endDate]);

  const summary = useMemo(() => computeSummary(settlements), [settlements]);

  const handleExportCsv = () => {
    if (filteredSettlements.length === 0) return;
    const csv = convertToCsv(filteredSettlements);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `kasuwa-settlements-${activeAddress.slice(0, 8)}-${dateStr}.csv`);
  };

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 16px' }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px 0' }}>
          Kasuwa Merchant Reconciliation
        </h1>
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
          Read-only settlement audit trail and shortfall dispute reconciliation.
        </p>
      </header>

      {/* Address Lookup */}
      <section
        aria-label="Merchant Lookup"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <form onSubmit={handleLookup} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label htmlFor="merchant-address" style={{ width: '100%', fontWeight: 600, fontSize: 14 }}>
            Merchant Stellar Address
          </label>
          <input
            id="merchant-address"
            type="text"
            placeholder="e.g. G..."
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            style={{
              flex: 1,
              minWidth: 280,
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'transparent',
              color: 'inherit',
              fontFamily: 'monospace',
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '10px 24px',
              borderRadius: 6,
              background: 'var(--accent-blue)',
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {loading ? 'Loading...' : 'Lookup Settlements'}
          </button>
        </form>

        {error && (
          <div role="alert" style={{ marginTop: 16, color: 'var(--accent-red)', fontSize: 14 }}>
            {error}
          </div>
        )}
      </section>

      {/* Summary Cards */}
      {activeAddress && (
        <section
          aria-label="Summary Cards"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Total Settled
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-green)' }}>
              {summary.totalSettledFormatted}
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Pending Settlements
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-amber)' }}>
              {summary.pendingCount}
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Rejected / Shortfall Count
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-red)' }}>
              {summary.rejectedCount}
            </div>
          </div>
        </section>
      )}

      {/* Filter Bar & Export */}
      {activeAddress && (
        <section
          aria-label="Filters and Export"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <label htmlFor="filter-status" style={{ fontSize: 13, marginRight: 8 }}>
                Status:
              </label>
              <select
                id="filter-status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  color: 'inherit',
                }}
              >
                <option value="all">All</option>
                <option value="settled">Settled</option>
                <option value="partial">Partial</option>
                <option value="rejected">Rejected</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            <div>
              <label htmlFor="filter-start" style={{ fontSize: 13, marginRight: 6 }}>
                From:
              </label>
              <input
                id="filter-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  color: 'inherit',
                }}
              />
            </div>

            <div>
              <label htmlFor="filter-end" style={{ fontSize: 13, marginRight: 6 }}>
                To:
              </label>
              <input
                id="filter-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  color: 'inherit',
                }}
              />
            </div>
          </div>

          <button
            onClick={handleExportCsv}
            disabled={filteredSettlements.length === 0}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              fontWeight: 600,
              cursor: filteredSettlements.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Export to CSV
          </button>
        </section>
      )}

      {/* Settlements Table */}
      {activeAddress && (
        <section
          aria-label="Settlement Table"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.02)' }}>
                <th style={{ padding: '12px 16px' }}>Date / Time</th>
                <th style={{ padding: '12px 16px' }}>Payment ID</th>
                <th style={{ padding: '12px 16px' }}>Amount</th>
                <th style={{ padding: '12px 16px' }}>Status</th>
                <th style={{ padding: '12px 16px' }}>Paid</th>
                <th style={{ padding: '12px 16px' }}>Shortfall</th>
                <th style={{ padding: '12px 16px' }}>Detail / Reason</th>
              </tr>
            </thead>
            <tbody>
              {filteredSettlements.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No settlements match criteria.
                  </td>
                </tr>
              ) : (
                filteredSettlements.map((item) => {
                  const date = new Date(item.acceptedAt * 1000).toLocaleString();
                  const badgeColor =
                    item.status === 'settled'
                      ? 'var(--accent-green)'
                      : item.status === 'partial'
                      ? 'var(--accent-amber)'
                      : item.status === 'rejected'
                      ? 'var(--accent-red)'
                      : 'var(--accent-blue)';

                  return (
                    <tr
                      key={item.paymentId}
                      style={{ borderBottom: '1px solid var(--border-color)' }}
                    >
                      <td style={{ padding: '12px 16px' }}>{date}</td>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace' }}>
                        {item.paymentId.slice(0, 12)}...
                      </td>
                      <td style={{ padding: '12px 16px' }}>{formatUsdc(item.amount)}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: 600,
                            border: `1px solid ${badgeColor}`,
                            color: badgeColor,
                          }}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>{formatUsdc(item.paid)}</td>
                      <td style={{ padding: '12px 16px', color: item.shortfall ? 'var(--accent-red)' : 'inherit' }}>
                        {formatUsdc(item.shortfall)}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                        {item.onChainResult ?? '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
