import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getAllOutboxEntries,
  getPendingOutboxEntries,
  applyOutboxAction,
} from './outboxRepository';
import { type OutboxEntry, type OutboxStatus } from './outboxReducer';
import { getConfig } from '../../config/env';

export function OutboxScreen(): React.JSX.Element {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<OutboxEntry | null>(null);

  const loadEntries = useCallback(async () => {
    try {
      const data = await getAllOutboxEntries();
      setEntries(data);
    } catch (err) {
      console.warn('Failed to load outbox:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleSettleAll = async () => {
    const pending = await getPendingOutboxEntries();
    if (pending.length === 0) {
      Alert.alert('Outbox Clean', 'No pending payments waiting to settle.');
      return;
    }

    setSettling(true);
    const config = getConfig();

    try {
      // Encode payloads for relayer batch submission
      const authorizations = pending.map((p) =>
        Buffer.from(p.rawBytes).toString('base64url'),
      );

      // Transition to SUBMIT_START
      for (const p of pending) {
        await applyOutboxAction(p.paymentId, { type: 'SUBMIT_START' });
      }
      await loadEntries();

      // Submit to Relayer API
      const res = await fetch(`${config.relayerUrl}/v1/settlements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.relayerApiKey}`,
        },
        body: JSON.stringify({ authorizations }),
      });

      if (!res.ok) {
        throw new Error(`Relayer HTTP ${res.status}: ${await res.text()}`);
      }

      // Mark settled locally (or handle individual results)
      for (const p of pending) {
        await applyOutboxAction(p.paymentId, {
          type: 'SUBMIT_SUCCESS',
          resultCode: 'Settled',
          paid: p.amount,
          shortfall: 0n,
        });
      }

      await loadEntries();
      Alert.alert(
        'Settlement Complete',
        `Successfully submitted ${pending.length} payment(s) to on-chain vault.`,
      );
    } catch (err: any) {
      // Record failure retry
      for (const p of pending) {
        await applyOutboxAction(p.paymentId, {
          type: 'SUBMIT_FAILURE',
          error: err?.message || 'Network unreachable',
        });
      }
      await loadEntries();
      Alert.alert(
        'Offline / Sync Notice',
        `Could not reach relayer (${err?.message || 'Offline'}). Authorizations remain securely queued in local SQLite outbox.`,
      );
    } finally {
      setSettling(false);
    }
  };

  const getStatusBadge = (status: OutboxStatus) => {
    switch (status) {
      case 'settled':
        return {
          color: '#10b981',
          bg: 'rgba(16, 185, 129, 0.15)',
          text: 'Settled ✓',
          icon: 'checkmark-circle',
        };
      case 'partial':
        return {
          color: '#a855f7',
          bg: 'rgba(168, 85, 247, 0.15)',
          text: 'Partial',
          icon: 'alert-circle',
        };
      case 'submitting':
        return {
          color: '#38bdf8',
          bg: 'rgba(56, 189, 248, 0.15)',
          text: 'Submitting',
          icon: 'sync',
        };
      case 'rejected':
      case 'expired':
        return {
          color: '#f43f5e',
          bg: 'rgba(244, 63, 94, 0.15)',
          text: status === 'expired' ? 'Expired' : 'Rejected',
          icon: 'close-circle',
        };
      default:
        return {
          color: '#f59e0b',
          bg: 'rgba(245, 158, 11, 0.15)',
          text: 'Queued (Offline)',
          icon: 'time',
        };
    }
  };

  // Metrics summary
  let pendingCount = 0;
  let settledTotal = 0n;
  for (const e of entries) {
    if (e.status === 'queued' || e.status === 'submitting' || e.status === 'failed_retry') {
      pendingCount++;
    }
    if (e.status === 'settled') {
      settledTotal += e.paid ?? e.amount;
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerSub}>SETTLEMENT PIPELINE</Text>
            <Text style={styles.headerTitle}>Merchant Outbox</Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={loadEntries}
            accessibilityLabel="Refresh outbox"
          >
            <Ionicons name="refresh" size={18} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Metrics Row */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Pending Sync</Text>
            <Text style={[styles.metricValue, { color: '#f59e0b' }]}>{pendingCount}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Settled Total</Text>
            <Text style={[styles.metricValue, { color: '#10b981' }]}>
              ${(Number(settledTotal) / 10_000_000).toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Settle Action Bar */}
        <TouchableOpacity
          style={[styles.settleButton, settling && { opacity: 0.7 }]}
          onPress={handleSettleAll}
          disabled={settling}
        >
          {settling ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={20} color="#000" />
              <Text style={styles.settleButtonText}>Settle Outbox On-Chain</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Outbox Entries List */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#f59e0b" />
          </View>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(item) => item.paymentId}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="receipt-outline" size={48} color="#334155" />
                <Text style={styles.emptyTitle}>Outbox Empty</Text>
                <Text style={styles.emptyText}>
                  Accepted offline payments waiting for internet connection will appear here.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const badge = getStatusBadge(item.status);
              return (
                <TouchableOpacity
                  style={styles.itemCard}
                  onPress={() => setSelectedEntry(item)}
                >
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemAmount}>
                      ${(Number(item.amount) / 10_000_000).toFixed(2)}{' '}
                      <Text style={{ fontSize: 13, color: '#94a3b8' }}>USDC</Text>
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                      <Ionicons name={badge.icon as any} size={12} color={badge.color} />
                      <Text style={[styles.statusBadgeText, { color: badge.color }]}>
                        {badge.text}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.itemMeta}>
                    <Text style={styles.itemMetaText}>
                      ID: {item.paymentId.slice(0, 14)}...
                    </Text>
                    <Text style={styles.itemMetaText}>
                      Allowance #{item.allowanceId}
                    </Text>
                  </View>

                  {item.shortfall !== null && item.shortfall > 0n && (
                    <View style={styles.shortfallBox}>
                      <Ionicons name="warning-outline" size={14} color="#f43f5e" />
                      <Text style={styles.shortfallText}>
                        Shortfall: ${(Number(item.shortfall) / 10_000_000).toFixed(2)} USDC (Disputed On-Chain)
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>

      {/* Entry Receipt Modal */}
      <Modal visible={!!selectedEntry} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Payment Receipt</Text>
              <TouchableOpacity onPress={() => setSelectedEntry(null)}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {selectedEntry && (
              <View style={styles.receiptDetails}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Payment ID</Text>
                  <Text style={styles.detailValMono}>{selectedEntry.paymentId}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Allowance Vault</Text>
                  <Text style={styles.detailVal}>#{selectedEntry.allowanceId}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Amount</Text>
                  <Text style={styles.detailVal}>
                    ${(Number(selectedEntry.amount) / 10_000_000).toFixed(2)} USDC
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Status</Text>
                  <Text style={styles.detailVal}>{selectedEntry.status.toUpperCase()}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Accepted At</Text>
                  <Text style={styles.detailVal}>
                    {new Date(selectedEntry.createdAt * 1000).toLocaleString()}
                  </Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setSelectedEntry(null)}
            >
              <Text style={styles.closeBtnText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#090d16' },
  inner: { flex: 1, padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerSub: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: '#f59e0b' },
  headerTitle: { fontSize: 26, fontWeight: '800', color: '#f8fafc', marginTop: 2 },
  refreshBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#1e293b',
  },
  metricsGrid: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  metricCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  metricLabel: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  metricValue: { fontSize: 24, fontWeight: '800' },
  settleButton: {
    backgroundColor: '#f59e0b',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  settleButtonText: { color: '#000', fontSize: 15, fontWeight: '700' },
  listContent: { paddingBottom: 24, gap: 12 },
  itemCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemAmount: { fontSize: 20, fontWeight: '800', color: '#f8fafc' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  itemMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  itemMetaText: { color: '#64748b', fontSize: 12, fontFamily: 'monospace' },
  shortfallBox: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shortfallText: { color: '#f43f5e', fontSize: 12, fontWeight: '600' },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#f8fafc', marginTop: 12, marginBottom: 6 },
  emptyText: { color: '#64748b', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalContent: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f8fafc' },
  receiptDetails: { backgroundColor: '#111827', borderRadius: 14, padding: 16, gap: 10, marginBottom: 20 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailKey: { color: '#64748b', fontSize: 13 },
  detailVal: { color: '#f8fafc', fontSize: 13, fontWeight: '600' },
  detailValMono: { color: '#f8fafc', fontSize: 12, fontFamily: 'monospace' },
  closeBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeBtnText: { color: '#f8fafc', fontSize: 15, fontWeight: '600' },
});
