import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import {
  decodePaymentRequest,
  encodePaymentAuthorization,
  type PaymentRequest,
  type PaymentAuthorization,
} from '@kasuwa/protocol';
import { buildAuthorization } from './authBuilder';
import { DeviceKey } from '../../native/DeviceKey';
import { getActiveAllowance, recordSpend } from '../allowance/allowanceRepository';

export function PayScreen(): React.JSX.Element {
  const [requestPayload, setRequestPayload] = useState('');
  const [decodedRequest, setDecodedRequest] = useState<PaymentRequest | null>(null);
  const [authorizedData, setAuthorizedData] = useState<{
    auth: PaymentAuthorization;
    encodedB64: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleScanOrSubmit = async (payloadToProcess?: string) => {
    const raw = (payloadToProcess ?? requestPayload).trim();
    if (!raw) {
      Alert.alert('Empty Payload', 'Please paste or scan a valid PaymentRequest QR.');
      return;
    }

    try {
      const buf = Buffer.from(raw, 'base64url');
      const req = decodePaymentRequest(buf);
      setDecodedRequest(req);
      setShowConfirmModal(true);
    } catch (err: any) {
      Alert.alert('Invalid QR', `Could not decode PaymentRequest: ${err?.message || 'bad format'}`);
    }
  };

  const handleConfirmPayment = async () => {
    if (!decodedRequest) return;
    setLoading(true);

    try {
      const allowance = await getActiveAllowance();
      if (!allowance) {
        throw new Error('No active allowance vault found. Please create one on the Allowance tab first.');
      }

      const available = allowance.balance - allowance.localSpent;
      if (decodedRequest.amount > available) {
        throw new Error(
          `Insufficient offline balance: Need ${(Number(decodedRequest.amount) / 10_000_000).toFixed(2)} USDC, but only ${(Number(available) / 10_000_000).toFixed(2)} USDC available.`,
        );
      }

      if (decodedRequest.amount > allowance.perPaymentCap) {
        throw new Error(
          `Payment exceeds per-payment cap: ${(Number(decodedRequest.amount) / 10_000_000).toFixed(2)} > ${(Number(allowance.perPaymentCap) / 10_000_000).toFixed(2)} USDC.`,
        );
      }

      // Build & Hardware Sign Payment Authorization with biometrics
      const auth = await buildAuthorization({
        request: decodedRequest,
        allowanceId: BigInt(allowance.allowanceId),
        deviceKey: DeviceKey,
        keyAlias: `kasuwa-allowance-${allowance.createdAt}`,
        biometricPrompt: `Authorize payment of ${(Number(decodedRequest.amount) / 10_000_000).toFixed(2)} USDC`,
      });

      const encoded = Buffer.from(encodePaymentAuthorization(auth)).toString('base64url');

      // Record offline spend locally
      await recordSpend(allowance.allowanceId, decodedRequest.amount);

      setAuthorizedData({ auth, encodedB64: encoded });
      setShowConfirmModal(false);
      setRequestPayload('');
    } catch (err: any) {
      Alert.alert('Authorization Failed', err?.message || 'Biometric signature rejected.');
    } finally {
      setLoading(false);
    }
  };

  const resetFlow = () => {
    setAuthorizedData(null);
    setDecodedRequest(null);
    setRequestPayload('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerSub}>OFFLINE SCANNER</Text>
          <Text style={styles.headerTitle}>Pay Merchant</Text>
        </View>

        {authorizedData ? (
          /* Step 2: Show QR Code to Merchant */
          <View style={styles.qrDisplayCard}>
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle" size={24} color="#10b981" />
              <Text style={styles.successText}>Payment Authorized ✓</Text>
            </View>

            <Text style={styles.qrInstruction}>
              Show this QR code to the merchant to release your goods.
            </Text>

            <View style={styles.qrContainer}>
              <QRCode
                value={authorizedData.encodedB64}
                size={230}
                color="#000000"
                backgroundColor="#ffffff"
              />
            </View>

            <View style={styles.receiptSummary}>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Amount Authorized</Text>
                <Text style={styles.receiptValue}>
                  ${(Number(authorizedData.auth.amount) / 10_000_000).toFixed(2)} USDC
                </Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Payment ID</Text>
                <Text style={styles.receiptValueMono}>
                  {Buffer.from(authorizedData.auth.paymentId).toString('hex').slice(0, 16)}...
                </Text>
              </View>
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Hardware Security</Text>
                <Text style={[styles.receiptValue, { color: '#10b981' }]}>
                  P-256 ECDSA Low-S
                </Text>
              </View>
            </View>

            <TouchableOpacity style={styles.doneButton} onPress={resetFlow}>
              <Text style={styles.doneButtonText}>Done / New Payment</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Step 1: Scan / Enter Request */
          <>
            {/* Viewfinder Target Simulator */}
            <View style={styles.viewfinderCard}>
              <View style={styles.viewfinderBox}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
                <Ionicons name="qr-code-outline" size={84} color="rgba(245, 158, 11, 0.4)" />
                <Text style={styles.viewfinderHint}>Align Merchant QR in Frame</Text>
              </View>
            </View>

            {/* Quick Demo / Paste Input */}
            <View style={styles.inputCard}>
              <Text style={styles.inputTitle}>Or Paste Merchant Request</Text>
              <TextInput
                style={styles.textInput}
                value={requestPayload}
                onChangeText={setRequestPayload}
                placeholder="Paste base64url payment request payload..."
                placeholderTextColor="#64748b"
                multiline
                numberOfLines={3}
              />
              <TouchableOpacity
                style={styles.scanButton}
                onPress={() => handleScanOrSubmit()}
              >
                <Ionicons name="scan-outline" size={20} color="#000" />
                <Text style={styles.scanButtonText}>Scan / Review Request</Text>
              </TouchableOpacity>
            </View>

            {/* Offline Info Badge */}
            <View style={styles.offlineNotice}>
              <Ionicons name="airplane" size={18} color="#f59e0b" />
              <Text style={styles.offlineNoticeText}>
                No internet required. Cryptographic authorization is signed locally with your device key.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* Confirmation & Biometric Authorization Modal */}
      <Modal visible={showConfirmModal} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm Payment</Text>
              <TouchableOpacity onPress={() => setShowConfirmModal(false)}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {decodedRequest && (
              <>
                <View style={styles.confirmAmountBox}>
                  <Text style={styles.confirmAmountLabel}>Pay Merchant</Text>
                  <Text style={styles.confirmAmountValue}>
                    ${(Number(decodedRequest.amount) / 10_000_000).toFixed(2)}{' '}
                    <Text style={{ fontSize: 16, color: '#94a3b8' }}>USDC</Text>
                  </Text>
                </View>

                <View style={styles.merchantDetailBox}>
                  <Text style={styles.detailLabel}>Merchant Account</Text>
                  <Text style={styles.detailValue}>
                    {Buffer.from(decodedRequest.merchant).toString('hex').slice(0, 24)}...
                  </Text>

                  <Text style={[styles.detailLabel, { marginTop: 12 }]}>Invoice Reference</Text>
                  <Text style={styles.detailValue}>
                    #{Buffer.from(decodedRequest.requestId).toString('hex')}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.authorizeButton}
                  onPress={handleConfirmPayment}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons name="finger-print" size={22} color="#000" />
                      <Text style={styles.authorizeButtonText}>Sign with Biometrics</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#090d16' },
  scroll: { padding: 20 },
  header: { marginBottom: 20 },
  headerSub: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: '#f59e0b' },
  headerTitle: { fontSize: 26, fontWeight: '800', color: '#f8fafc', marginTop: 2 },
  viewfinderCard: {
    backgroundColor: '#111827',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 20,
  },
  viewfinderBox: {
    width: 240,
    height: 240,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#f59e0b',
  },
  cornerTL: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 6 },
  cornerTR: { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 6 },
  cornerBL: { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 6 },
  viewfinderHint: { color: '#94a3b8', fontSize: 13, marginTop: 12, fontWeight: '600' },
  inputCard: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 16,
  },
  inputTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '700', marginBottom: 10 },
  textInput: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#f8fafc',
    fontSize: 13,
    padding: 12,
    fontFamily: 'monospace',
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  scanButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scanButtonText: { color: '#000', fontSize: 15, fontWeight: '700' },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  offlineNoticeText: { color: '#fbbf24', fontSize: 13, flex: 1, lineHeight: 18 },
  qrDisplayCard: {
    backgroundColor: '#111827',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  successText: { color: '#10b981', fontSize: 18, fontWeight: '800' },
  qrInstruction: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  qrContainer: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  receiptSummary: {
    width: '100%',
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 20,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  receiptLabel: { color: '#64748b', fontSize: 13 },
  receiptValue: { color: '#f8fafc', fontSize: 14, fontWeight: '700' },
  receiptValueMono: { color: '#f8fafc', fontSize: 13, fontFamily: 'monospace' },
  doneButton: {
    width: '100%',
    backgroundColor: '#1e293b',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  doneButtonText: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
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
  confirmAmountBox: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 16,
  },
  confirmAmountLabel: { color: '#94a3b8', fontSize: 13, marginBottom: 4 },
  confirmAmountValue: { color: '#f8fafc', fontSize: 32, fontWeight: '900' },
  merchantDetailBox: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 24,
  },
  detailLabel: { color: '#64748b', fontSize: 12, marginBottom: 2 },
  detailValue: { color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace' },
  authorizeButton: {
    backgroundColor: '#f59e0b',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  authorizeButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
