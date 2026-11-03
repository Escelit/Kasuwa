'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  SettlementItem,
  formatUsdc,
  computeSummary,
  fetchMerchantSettlements,
} from '../src/api.js';
import { convertToCsv, downloadCsv } from '../src/exportCsv.js';

export default function MerchantReconciliationPage() {
  const [addressInput, setAddressInput] = useState('0101010101010101010101010101010101010101010101010101010101010101');
  const [activeAddress, setActiveAddress] = useState('0101010101010101010101010101010101010101010101010101010101010101');
  const [settlements, setSettlements] = useState<SettlementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live Auto-Refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected item for Cryptographic Inspector Modal
  const [inspectItem, setInspectItem] = useState<SettlementItem | null>(null);

  const loadSettlements = useCallback(
    async (targetAddress: string) => {
      const clean = targetAddress.trim();
      if (!clean) return;

      setLoading(true);
      setError(null);
      try {
        const data = await fetchMerchantSettlements(clean);
        setSettlements(data.settlements || []);
        setActiveAddress(clean);
        setLastRefreshedAt(new Date());
      } catch (err: any) {
        // If indexer is offline or address has no items, show friendly fallback
        setError(err instanceof Error ? err.message : String(err));
        setSettlements([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    loadSettlements(activeAddress);
  }, [loadSettlements, activeAddress]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh || !activeAddress) return;
    const interval = setInterval(() => {
      loadSettlements(activeAddress);
    }, 8000);
    return () => clearInterval(interval);
  }, [autoRefresh, activeAddress, loadSettlements]);

  const handleLookup = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (addressInput.trim()) {
      loadSettlements(addressInput.trim());
    }
  };

  const filteredSettlements = useMemo(() => {
    return settlements.filter((item) => {
      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'pending') {
          if (item.status !== 'accepted' && item.status !== 'submitting') return false;
        } else if (item.status !== statusFilter) {
          return false;
        }
      }

      // Search query (payment ID or allowance ID)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchPay = item.paymentId.toLowerCase().includes(q);
        const matchAllow = item.allowanceId.toLowerCase().includes(q);
        if (!matchPay && !matchAllow) return false;
      }

      return true;
    });
  }, [settlements, statusFilter, searchQuery]);

  const summary = useMemo(() => computeSummary(settlements), [settlements]);

  const totalShortfall = useMemo(() => {
    let sf = 0n;
    for (const item of settlements) {
      if (item.shortfall) {
        sf += BigInt(item.shortfall);
      }
    }
    return sf;
  }, [settlements]);

  const handleExportCsv = () => {
    if (filteredSettlements.length === 0) return;
    const csv = convertToCsv(filteredSettlements);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `kasuwa-settlements-${activeAddress.slice(0, 8)}-${dateStr}.csv`);
  };

  const handleExportJson = () => {
    if (filteredSettlements.length === 0) return;
    const jsonStr = JSON.stringify(filteredSettlements, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kasuwa-settlements-${activeAddress.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navbar */}
      <nav
        style={{
          borderBottom: '1px solid var(--border-color)',
          background: 'rgba(13, 18, 34, 0.8)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            padding: '16px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#000',
                fontWeight: 900,
                fontSize: 20,
              }}
            >
              K
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>
                Kasuwa <span style={{ color: 'var(--accent-gold)' }}>Merchant</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Offline Settlement & Dispute Reconciliation
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--bg-card)',
                padding: '6px 14px',
                borderRadius: 20,
                border: '1px solid var(--border-color)',
                fontSize: 12,
              }}
            >
              <div
                className="pulse-anim"
                style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: 'var(--accent-green)' }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>Soroban Network:</span>
              <span style={{ fontWeight: 700, color: '#f8fafc' }}>Testnet</span>
            </div>

            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: autoRefresh ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-card)',
                color: autoRefresh ? 'var(--accent-green)' : 'var(--text-secondary)',
                border: `1px solid ${autoRefresh ? 'var(--accent-green)' : 'var(--border-color)'}`,
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <span>{autoRefresh ? '● Auto-Sync ON' : '○ Auto-Sync OFF'}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                ({lastRefreshedAt.toLocaleTimeString()})
              </span>
            </button>
          </div>
        </div>
      </nav>

      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px', flex: 1, width: '100%' }}>
        {/* Merchant Search & Quick Presets */}
        <section
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 16,
            padding: 24,
            marginBottom: 24,
            boxShadow: 'var(--shadow-subtle)',
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px 0' }}>
              Merchant Terminal Account
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Enter the merchant's 32-byte hex key or G... account to inspect on-chain settlement balances and shortfall audit trails.
            </p>
          </div>

          <form onSubmit={handleLookup} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="e.g. 0101010101010101... or G..."
              style={{
                flex: 1,
                minWidth: 320,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-highlight)',
                borderRadius: 10,
                padding: '12px 16px',
                color: '#f8fafc',
                fontSize: 14,
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                backgroundColor: 'var(--accent-gold)',
                color: '#000',
                border: 'none',
                borderRadius: 10,
                padding: '12px 24px',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              {loading ? 'Querying Indexer...' : 'Load Settlements'}
            </button>
          </form>

          {/* Quick Demo Presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quick Presets:</span>
            <button
              type="button"
              onClick={() => {
                const addr = '0101010101010101010101010101010101010101010101010101010101010101';
                setAddressInput(addr);
                loadSettlements(addr);
              }}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Merchant 1 (Primary)
            </button>
            <button
              type="button"
              onClick={() => {
                const addr = '0202020202020202020202020202020202020202020202020202020202020202';
                setAddressInput(addr);
                loadSettlements(addr);
              }}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Merchant 2 (Disputed Shortfall)
            </button>
          </div>

          {error && (
            <div
              style={{
                marginTop: 16,
                padding: '12px 16px',
                backgroundColor: 'rgba(244, 63, 94, 0.1)',
                border: '1px solid rgba(244, 63, 94, 0.25)',
                borderRadius: 8,
                color: 'var(--accent-red)',
                fontSize: 13,
              }}
            >
              Notice: {error} (Indexer is running in memory or waiting for network events)
            </div>
          )}
        </section>

        {/* Hero Metric Cards */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          {/* Total Settled */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 16,
              padding: 20,
              boxShadow: 'var(--shadow-subtle)',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Total Settled Revenue
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#f8fafc' }}>
              {summary.totalSettledFormatted}
            </div>
            <div style={{ fontSize: 12, color: 'var(--accent-green)', marginTop: 4, fontWeight: 600 }}>
              ✓ Fully paid from on-chain escrow
            </div>
          </div>

          {/* Pending Outbox */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 16,
              padding: 20,
              boxShadow: 'var(--shadow-subtle)',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Pending In Submission
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--accent-gold)' }}>
              {summary.pendingCount}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              Accepted offline, awaiting batch
            </div>
          </div>

          {/* On-Chain Shortfalls */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 16,
              padding: 20,
              boxShadow: 'var(--shadow-subtle)',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Attributed Shortfalls (Disputes)
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 800,
                color: totalShortfall > 0n ? 'var(--accent-red)' : 'var(--text-primary)',
              }}
            >
              {formatUsdc(totalShortfall)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              Recorded on-chain against customer device keys
            </div>
          </div>

          {/* Total Payments */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 16,
              padding: 20,
              boxShadow: 'var(--shadow-subtle)',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Total Processed
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#f8fafc' }}>
              {summary.totalCount}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              Reconciliation audit records
            </div>
          </div>
        </section>

        {/* Filter and Action Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          {/* Status Filter Pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: 'All' },
              { id: 'settled', label: 'Settled' },
              { id: 'partial', label: 'Partial Shortfalls' },
              { id: 'pending', label: 'Pending' },
              { id: 'rejected', label: 'Rejected' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                style={{
                  background: statusFilter === f.id ? 'var(--accent-gold)' : 'var(--bg-card)',
                  color: statusFilter === f.id ? '#000' : 'var(--text-secondary)',
                  border: `1px solid ${statusFilter === f.id ? 'var(--accent-gold)' : 'var(--border-color)'}`,
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search & Export Buttons */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search Payment ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#f8fafc',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              onClick={handleExportCsv}
              disabled={filteredSettlements.length === 0}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                color: '#f8fafc',
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Export CSV
            </button>
            <button
              onClick={handleExportJson}
              disabled={filteredSettlements.length === 0}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                color: '#f8fafc',
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Export JSON
            </button>
          </div>
        </div>

        {/* Settlement Data Table */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: 'var(--shadow-subtle)',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '14px 16px', fontWeight: 600 }}>Time (UTC)</th>
                  <th style={{ padding: '14px 16px', fontWeight: 600 }}>Payment ID</th>
                  <th style={{ padding: '14px 16px', fontWeight: 600 }}>Allowance Vault</th>
                  <th style={{ padding: '14px 16px', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '14px 16px', fontWeight: 600 }}>Requested</th>
                  <th style={{ padding: '14px 16px', fontWeight: 600 }}>Paid Out</th>
                  <th style={{ padding: '14px 16px', fontWeight: 600 }}>Shortfall</th>
                  <th style={{ padding: '14px 16px', fontWeight: 600 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredSettlements.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No settlement records found for this merchant address and filter.
                    </td>
                  </tr>
                ) : (
                  filteredSettlements.map((item) => {
                    const isSettled = item.status === 'settled';
                    const isPartial = item.status === 'partial';
                    const isRejected = item.status === 'rejected';

                    const badgeBg = isSettled
                      ? 'rgba(16, 185, 129, 0.15)'
                      : isPartial
                        ? 'rgba(168, 85, 247, 0.15)'
                        : isRejected
                          ? 'rgba(244, 63, 94, 0.15)'
                          : 'rgba(245, 158, 11, 0.15)';

                    const badgeColor = isSettled
                      ? 'var(--accent-green)'
                      : isPartial
                        ? 'var(--accent-purple)'
                        : isRejected
                          ? 'var(--accent-red)'
                          : 'var(--accent-gold)';

                    return (
                      <tr
                        key={item.paymentId}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          cursor: 'pointer',
                        }}
                        onClick={() => setInspectItem(item)}
                      >
                        <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                          {new Date(item.acceptedAt * 1000).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontWeight: 600 }}>
                          {item.paymentId.slice(0, 14)}...
                        </td>
                        <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                          #{item.allowanceId}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span
                            style={{
                              backgroundColor: badgeBg,
                              color: badgeColor,
                              padding: '4px 8px',
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                            }}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', fontWeight: 600 }}>
                          {formatUsdc(item.amount)}
                        </td>
                        <td style={{ padding: '14px 16px', color: 'var(--accent-green)', fontWeight: 700 }}>
                          {item.paid ? formatUsdc(item.paid) : '—'}
                        </td>
                        <td
                          style={{
                            padding: '14px 16px',
                            color: item.shortfall && BigInt(item.shortfall) > 0n ? 'var(--accent-red)' : 'var(--text-muted)',
                            fontWeight: 700,
                          }}
                        >
                          {item.shortfall && BigInt(item.shortfall) > 0n ? formatUsdc(item.shortfall) : '—'}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectItem(item);
                            }}
                            style={{
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-color)',
                              color: 'var(--accent-blue)',
                              padding: '4px 8px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Audit
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Cryptographic Inspector & Dispute Audit Modal */}
      {inspectItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 50,
          }}
          onClick={() => setInspectItem(null)}
        >
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-highlight)',
              borderRadius: 20,
              padding: 28,
              maxWidth: 580,
              width: '100%',
              boxShadow: 'var(--shadow-subtle)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                Cryptographic Settlement Audit
              </h3>
              <button
                onClick={() => setInspectItem(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: 20,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: 'var(--text-muted)' }}>Payment ID</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{inspectItem.paymentId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: 'var(--text-muted)' }}>Allowance ID</span>
                <span>#{inspectItem.allowanceId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: 'var(--text-muted)' }}>Settlement Status</span>
                <span style={{ fontWeight: 700 }}>{inspectItem.status.toUpperCase()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: 'var(--text-muted)' }}>Requested Amount</span>
                <span>{formatUsdc(inspectItem.amount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: 'var(--text-muted)' }}>Amount Paid Out</span>
                <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>
                  {inspectItem.paid ? formatUsdc(inspectItem.paid) : '0.00 USDC'}
                </span>
              </div>
              {inspectItem.shortfall && BigInt(inspectItem.shortfall) > 0n && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingTop: 10,
                    borderTop: '1px solid var(--border-color)',
                  }}
                >
                  <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>Attributed Shortfall</span>
                  <span style={{ color: 'var(--accent-red)', fontWeight: 800 }}>
                    {formatUsdc(inspectItem.shortfall)}
                  </span>
                </div>
              )}
            </div>

            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                background: 'var(--bg-card)',
                borderRadius: 12,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--accent-gold)', marginBottom: 4 }}>
                Escrow Invariant Guarantee:
              </div>
              Every payment authorization is signed with secp256r1 hardware keys. If a double-spend attempt exhausted the customer's balance, the deficit is permanently committed on-chain against the device key as living audit evidence.
            </div>

            <button
              onClick={() => setInspectItem(null)}
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                color: '#f8fafc',
                padding: '12px 0',
                borderRadius: 10,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Close Audit Inspector
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
