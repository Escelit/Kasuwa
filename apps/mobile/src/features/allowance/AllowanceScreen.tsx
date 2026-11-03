import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DeviceKey, isSoftwareFallback } from '../../native/DeviceKey';
import {
  getActiveAllowance,
  saveAllowance,
  topUpAllowance,
  requestCloseAllowance,
  reclaimAllowance,
  CustomerAllowanceRecord,
} from './allowanceRepository';

export function AllowanceScreen(): React.JSX.Element {
  const [allowance, setAllowance] = useState<CustomerAllowanceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Form states
  const [amountInput, setAmountInput] = useState('20');
  const [capInput, setCapInput] = useState('15');
  const [durationDays, setDurationDays] = useState('7');
  const [topUpAmount, setTopUpAmount] = useState('10');

  const loadData = useCallback(async () => {
    try {
      const active = await getActiveAllowance();
      setAllowance(active);
    } catch (err) {
      console.warn('Failed to load allowance:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateAllowance = async () => {
    const amt = parseFloat(amountInput);
    const cap = parseFloat(capInput);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid deposit amount.');
      return;
    }
    if (isNaN(cap) || cap <= 0 || cap > amt) {
      Alert.alert('Invalid Cap', 'Per-payment cap must be between 0 and deposit amount.');
      return;
    }

    setActionLoading(true);
    try {
      // Hardware-backed P-256 key generation
      const alias = `kasuwa-allowance-${Date.now()}`;
      const { publicKey } = await DeviceKey.generate(alias, { requireBiometric: true });
      const deviceKeyHex = Buffer.from(publicKey).toString('hex');

      const now = Math.floor(Date.now() / 1000);
      const validUntil = now + parseInt(durationDays, 10) * 86400;

      // In real on-chain flow, this calls VaultClient.createAllowance with customer Stellar account
      const baseUnitsAmt = BigInt(Math.round(amt * 10_000_000));
      const baseUnitsCap = BigInt(Math.round(cap * 10_000_000));
      const newId = String(Date.now()).slice(-8);

      const record: CustomerAllowanceRecord = {
        allowanceId: newId,
        owner: 'G_CUSTOMER_WALLET',
        token: 'USDC',
        deviceKeyHex,
        balance: baseUnitsAmt,
        perPaymentCap: baseUnitsCap,
        validUntil,
        status: 'Active',
        localSpent: 0n,
        createdAt: now,
        updatedAt: now,
      };

      await saveAllowance(record);
      setAllowance(record);
      setShowCreateModal(false);
      Alert.alert('Escrow Created', `Allowance #${newId} funded with ${amt} USDC.`);
    } catch (err: any) {
      Alert.alert('Authentication Failed', err?.message || 'Biometric key generation failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTopUp = async () => {
    if (!allowance) return;
    const amt = parseFloat(topUpAmount);
    if (isNaN(amt) || amt <= 0) return;

    setActionLoading(true);
    try {
      const addUnits = BigInt(Math.round(amt * 10_000_000));
      await topUpAllowance(allowance.allowanceId, addUnits);
      await loadData();
      setShowTopUpModal(false);
      Alert.alert('Topped Up', `Added ${amt} USDC to offline allowance.`);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Top up failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestClose = () => {
    if (!allowance) return;
    Alert.alert(
      'Emergency Freeze & Close?',
      'Freezes new top-ups immediately and begins the reclaim window countdown. Any unspent balance will be reclaimable after the security window.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Freeze Now',
          style: 'destructive',
          onPress: async () => {
            await requestCloseAllowance(allowance.allowanceId);
            await loadData();
          },
        },
      ],
    );
  };

  const handleReclaim = async () => {
    if (!allowance) return;
    setActionLoading(true);
    try {
      await reclaimAllowance(allowance.allowanceId);
      await loadData();
      Alert.alert('Funds Reclaimed', 'Unspent balance returned to your primary wallet.');
    } catch (err: any) {
      Alert.alert('Reclaim Notice', err?.message || 'Reclaim window has not yet passed.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#f59e0b" />
      </SafeAreaView>
    );
  }

  // Calculate formatted amounts
  const totalBalance = allowance ? Number(allowance.balance) / 10_000_000 : 0;
  const spent = allowance ? Number(allowance.localSpent) / 10_000_000 : 0;
  const available = Math.max(0, totalBalance - spent);
  const spentRatio = totalBalance > 0 ? Math.min(1, spent / totalBalance) : 0;
  const cap = allowance ? Number(allowance.perPaymentCap) / 10_000_000 : 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerSub}>OFFLINE ESCROW VAULT</Text>
            <Text style={styles.headerTitle}>Digital Cash Reserve</Text>
          </View>
          <View style={styles.badgeHardware}>
            <Ionicons
              name={isSoftwareFallback ? 'shield-outline' : 'shield-checkmark'}
              size={14}
              color={isSoftwareFallback ? '#f59e0b' : '#10b981'}
            />
            <Text style={styles.badgeText}>
              {isSoftwareFallback ? 'Dev Key' : 'Secure Enclave'}
            </Text>
          </View>
        </View>

        {allowance ? (
          <>
            {/* Main Balance Card */}
            <View style={styles.vaultCard}>
              <View style={styles.vaultCardHeader}>
                <View style={styles.statusPill}>
                  <View style={styles.statusDot} />
                  <Text style={styles.statusText}>{allowance.status.toUpperCase()}</Text>
                </View>
                <Text style={styles.allowanceIdText}>ID #{allowance.allowanceId}</Text>
              </View>

              <Text style={styles.balanceLabel}>Available Offline</Text>
              <View style={styles.balanceRow}>
                <Text style={styles.currencySymbol}>$</Text>
                <Text style={styles.balanceAmount}>{available.toFixed(2)}</Text>
                <Text style={styles.currencyCode}>USDC</Text>
              </View>

              {/* Progress Bar */}
              <View style={styles.progressContainer}>
                <View style={[styles.progressBar, { width: `${(1 - spentRatio) * 100}%` }]} />
              </View>

              <View style={styles.statGrid}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Deposited</Text>
                  <Text style={styles.statValue}>${totalBalance.toFixed(2)}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Local Spent</Text>
                  <Text style={[styles.statValue, { color: '#f59e0b' }]}>
                    ${spent.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Limit / Pay</Text>
                  <Text style={styles.statValue}>${cap.toFixed(2)}</Text>
                </View>
              </View>

              <View style={styles.vaultFooter}>
                <Ionicons name="time-outline" size={14} color="#94a3b8" />
                <Text style={styles.vaultFooterText}>
                  Valid until {new Date(allowance.validUntil * 1000).toLocaleDateString()}
                </Text>
              </View>
            </View>

            {/* Action Buttons Grid */}
            <View style={styles.actionsGrid}>
              <TouchableOpacity
                style={styles.actionBtnPrimary}
                onPress={() => setShowTopUpModal(true)}
              >
                <Ionicons name="add-circle-outline" size={20} color="#fff" />
                <Text style={styles.actionBtnPrimaryText}>Top Up</Text>
              </TouchableOpacity>

              {allowance.status === 'Active' ? (
                <TouchableOpacity
                  style={styles.actionBtnSecondary}
                  onPress={handleRequestClose}
                >
                  <Ionicons name="lock-closed-outline" size={20} color="#94a3b8" />
                  <Text style={styles.actionBtnSecondaryText}>Freeze & Close</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.actionBtnSecondary, { borderColor: '#10b981' }]}
                  onPress={handleReclaim}
                >
                  <Ionicons name="arrow-down-circle-outline" size={20} color="#10b981" />
                  <Text style={[styles.actionBtnSecondaryText, { color: '#10b981' }]}>
                    Reclaim
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        ) : (
          /* Empty State - Create Allowance */
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="wallet-outline" size={36} color="#f59e0b" />
            </View>
            <Text style={styles.emptyTitle}>No Active Allowance</Text>
            <Text style={styles.emptyBody}>
              Lock a small prefunded allowance into the Soroban vault while you have internet. You
              can then pay merchants offline with zero signal.
            </Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => setShowCreateModal(true)}
            >
              <Ionicons name="flash-outline" size={18} color="#000" />
              <Text style={styles.createButtonText}>Fund Offline Allowance</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Security & Verification Guarantee Card */}
        <View style={styles.infoCard}>
          <View style={styles.infoTitleRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#10b981" />
            <Text style={styles.infoTitle}>Non-Custodial Security</Text>
          </View>
          <Text style={styles.infoBody}>
            Funds are held directly in the Soroban smart contract. Only your device's biometric
            signatures can authorize payment settlements to merchants.
          </Text>
        </View>
      </ScrollView>

      {/* Create Allowance Modal */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Fund Offline Allowance</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Deposit Amount (USDC)</Text>
            <TextInput
              style={styles.input}
              value={amountInput}
              onChangeText={setAmountInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 20"
              placeholderTextColor="#64748b"
            />

            <View style={styles.pillsRow}>
              {['10', '25', '50', '100'].map((val) => (
                <TouchableOpacity
                  key={val}
                  style={[styles.pill, amountInput === val && styles.pillActive]}
                  onPress={() => setAmountInput(val)}
                >
                  <Text
                    style={[styles.pillText, amountInput === val && styles.pillTextActive]}
                  >
                    ${val}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.inputLabel}>Per-Payment Cap (USDC)</Text>
            <TextInput
              style={styles.input}
              value={capInput}
              onChangeText={setCapInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 15"
              placeholderTextColor="#64748b"
            />

            <Text style={styles.inputLabel}>Validity Duration (Days)</Text>
            <TextInput
              style={styles.input}
              value={durationDays}
              onChangeText={setDurationDays}
              keyboardType="number-pad"
              placeholder="7"
              placeholderTextColor="#64748b"
            />

            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleCreateAllowance}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Ionicons name="finger-print-outline" size={20} color="#000" />
                  <Text style={styles.submitButtonText}>Authorize & Escrow</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Top Up Modal */}
      <Modal visible={showTopUpModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Top Up Allowance</Text>
              <TouchableOpacity onPress={() => setShowTopUpModal(false)}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Add USDC</Text>
            <TextInput
              style={styles.input}
              value={topUpAmount}
              onChangeText={setTopUpAmount}
              keyboardType="decimal-pad"
              placeholder="10"
              placeholderTextColor="#64748b"
            />

            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleTopUp}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.submitButtonText}>Confirm Top Up</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#090d16' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#090d16' },
  scroll: { padding: 20 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerSub: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: '#f59e0b' },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#f8fafc', marginTop: 2 },
  badgeHardware: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1e293b',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  badgeText: { fontSize: 12, fontWeight: '600', color: '#e2e8f0' },
  vaultCard: {
    backgroundColor: '#111827',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 20,
  },
  vaultCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981' },
  statusText: { color: '#10b981', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  allowanceIdText: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' },
  balanceLabel: { color: '#94a3b8', fontSize: 13, fontWeight: '500' },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4, marginBottom: 18 },
  currencySymbol: { fontSize: 26, fontWeight: '700', color: '#f59e0b', marginRight: 2 },
  balanceAmount: { fontSize: 42, fontWeight: '900', color: '#ffffff', letterSpacing: -1 },
  currencyCode: { fontSize: 16, fontWeight: '600', color: '#94a3b8', marginLeft: 8 },
  progressContainer: {
    height: 8,
    backgroundColor: '#1f2937',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressBar: { height: '100%', backgroundColor: '#f59e0b', borderRadius: 4 },
  statGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#1f2937',
    marginBottom: 14,
  },
  statItem: { alignItems: 'center' },
  statLabel: { color: '#64748b', fontSize: 12, marginBottom: 4 },
  statValue: { color: '#f1f5f9', fontSize: 15, fontWeight: '700' },
  vaultFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vaultFooterText: { color: '#94a3b8', fontSize: 12 },
  actionsGrid: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  actionBtnPrimary: {
    flex: 1,
    backgroundColor: '#d97706',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionBtnPrimaryText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionBtnSecondaryText: { color: '#cbd5e1', fontSize: 15, fontWeight: '600' },
  emptyCard: {
    backgroundColor: '#111827',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 24,
  },
  emptyIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#f8fafc', marginBottom: 8 },
  emptyBody: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  createButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  createButtonText: { color: '#000', fontSize: 15, fontWeight: '700' },
  infoCard: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  infoTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  infoTitle: { color: '#10b981', fontSize: 14, fontWeight: '700' },
  infoBody: { color: '#94a3b8', fontSize: 13, lineHeight: 18 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f8fafc' },
  inputLabel: { fontSize: 13, color: '#94a3b8', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#f8fafc',
    fontSize: 16,
    padding: 14,
  },
  pillsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  pill: {
    flex: 1,
    backgroundColor: '#1e293b',
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  pillActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  pillText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: '#000', fontWeight: '700' },
  submitButton: {
    backgroundColor: '#f59e0b',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 24,
    marginBottom: 12,
  },
  submitButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
