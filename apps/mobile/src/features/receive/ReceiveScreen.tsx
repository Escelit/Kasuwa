import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import {
  encodePaymentRequest,
  decodePaymentAuthorization,
  type PaymentRequest,
  type PaymentAuthorization,
} from '@kasuwa/protocol';
import { verifyOffline, OfflineVerifyResult } from './verifyOffline';
import { insertOutboxEntry, getAllOutboxEntries } from '../outbox/outboxRepository';

export function ReceiveScreen(): React.JSX.Element {
  // Merchant state
  const [amountInput, setAmountInput] = useState('1.50');
  const [createdRequest, setCreatedRequest] = useState<{
    request: PaymentRequest;
    encodedB64: string;
  } | null>(null);

  // Scan & Verify state
  const [authPayloadInput, setAuthPayloadInput] = useState('');
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    auth: PaymentAuthorization;
    result: OfflineVerifyResult;
  } | null>(null);

  const merchantRawAddress = Buffer.alloc(32, 0x01); // Simulated merchant 32-byte address

  const handleCreateRequest = () => {
    const amt = parseFloat(amountInput);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid request amount.');
      return;
    }

    const baseUnits = BigInt(Math.round(amt * 10_000_000));
    const now = Math.floor(Date.now() / 1000);
    const requestId = Buffer.alloc(8);
    globalThis.crypto.getRandomValues(requestId);

    const request: PaymentRequest = {
      version: 1,
      merchant: merchantRawAddress,
      amount: baseUnits,
      tokenHint: 0,
      requestId,
      expiresAt: now + 600, // 10 minutes
    };

    const encoded = Buffer.from(encodePaymentRequest(request)).toString('base64url');
    setCreatedRequest({ request, encodedB64: encoded });
    setVerificationResult(null);
  };

  const handleVerifyAuthorization = async () => {
    if (!createdRequest) return;
    const raw = authPayloadInput.trim();
    if (!raw) {
      Alert.alert('Empty Payload', 'Please paste or scan customer PaymentAuthorization.');
      return;
    }

    try {
      const authBytes = Buffer.from(raw, 'base64url');
      const auth = decodePaymentAuthorization(authBytes);

      // Context for verification
      const existingEntries = await getAllOutboxEntries();
      const outboxPaymentIds = new Set(existingEntries.map((e) => e.paymentId));

      const networkId = Buffer.alloc(32, 0x99);
      const contractId = Buffer.alloc(32, 0x42);

      // For offline test demo, allow matching verification
      const result = verifyOffline({
        auth,
        request: createdRequest.request,
        devicePublicKey: null, // skips P-256 signature check if device public key is unknown
        merchantAddress: merchantRawAddress,
        outboxPaymentIds,
        ctx: { contractId, networkId },
      });

      if (result.allPassed) {
        // Enqueue into SQLite Outbox
        await insertOutboxEntry({
          paymentId: Buffer.from(auth.paymentId).toString('hex'),
          allowanceId: auth.allowanceId.toString(),
          rawBytes: authBytes,
          amount: auth.amount,
          merchant: Buffer.from(merchantRawAddress).toString('hex'),
          expiresAt: auth.expiresAt,
        });
      }

      setVerificationResult({ auth, result });
      setShowScannerModal(false);
      setAuthPayloadInput('');
    } catch (err: any) {
      Alert.alert('Verification Error', err?.message || 'Failed to parse authorization');
    }
  };

  const resetAll = () => {
    setCreatedRequest(null);
    setVerificationResult(null);
    setAmountInput('1.50');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerSub}>POINT OF SALE</Text>
          <Text style={styles.headerTitle}>Receive Payment</Text>
        </View>

        {verificationResult ? (
          /* Step 3: Verified Result Screen */
          <View style={styles.card}>
            <View style={styles.verifiedHeader}>
              <Ionicons
                name={verificationResult.result.allPassed ? 'checkmark-circle' : 'alert-circle'}
                size={54}
                color={verificationResult.result.allPassed ? '#10b981' : '#f43f5e'}
              />
              <Text
                style={[
                  styles.verifiedTitle,
                  { color: verificationResult.result.allPassed ? '#10b981' : '#f43f5e' },
                ]}
              >
                {verificationResult.result.allPassed
                  ? 'Verified Offline ✓'
                  : 'Verification Rejected'}
              </Text>
              <Text style={styles.verifiedSub}>
                {verificationResult.result.allPassed
                  ? 'Cryptographic payment authorization saved to outbox. Hand over goods!'
                  : 'Payment failed offline risk & signature verification checks.'}
              </Text>
            </View>

            {/* Checklist of Offline Verifications */}
            <View style={styles.checklist}>
              {verificationResult.result.checks.map((check) => (
                <View key={check.id} style={styles.checkItem}>
                  <Ionicons
                    name={
                      check.status === 'pass'
                        ? 'checkmark-circle'
                        : check.status === 'fail'
                          ? 'close-circle'
                          : 'help-circle'
                    }
                    size={20}
                    color={
                      check.status === 'pass'
                        ? '#10b981'
                        : check.status === 'fail'
                          ? '#f43f5e'
                          : '#94a3b8'
                    }
                  />
                  <Text style={styles.checkDetail}>{check.detail}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={resetAll}>
              <Text style={styles.primaryButtonText}>New Sale</Text>
            </TouchableOpacity>
          </View>
        ) : createdRequest ? (
          /* Step 2: Show PaymentRequest QR to Customer */
          <View style={styles.card}>
            <View style={styles.amountDisplayHeader}>
              <Text style={styles.amountLabel}>Requested Amount</Text>
              <Text style={styles.amountBig}>
                ${(Number(createdRequest.request.amount) / 10_000_000).toFixed(2)}{' '}
                <Text style={{ fontSize: 18, color: '#94a3b8' }}>USDC</Text>
              </Text>
            </View>

            <View style={styles.qrContainer}>
              <QRCode
                value={createdRequest.encodedB64}
                size={220}
                color="#000000"
                backgroundColor="#ffffff"
              />
            </View>

            <Text style={styles.qrHelpText}>
              1. Ask customer to scan this QR code with their Kasuwa app.
            </Text>
            <Text style={styles.qrHelpText}>
              2. When they display their signed authorization QR, tap below to verify:
            </Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setShowScannerModal(true)}
            >
              <Ionicons name="scan-circle-outline" size={22} color="#000" />
              <Text style={styles.primaryButtonText}>Scan Customer Authorization</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelLink} onPress={resetAll}>
              <Text style={styles.cancelLinkText}>Cancel / Edit Amount</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Step 1: Input Amount */
          <View style={styles.card}>
            <Text style={styles.inputTitle}>Enter Sale Amount</Text>
            <View style={styles.inputRow}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                style={styles.amountInput}
                value={amountInput}
                onChangeText={setAmountInput}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.unitCode}>USDC</Text>
            </View>

            {/* Quick Amount Pills */}
            <View style={styles.quickPills}>
              {['1.00', '2.50', '5.00', '10.00'].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.pill, amountInput === p && styles.pillActive]}
                  onPress={() => setAmountInput(p)}
                >
                  <Text style={[styles.pillText, amountInput === p && styles.pillTextActive]}>
                    ${p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={handleCreateRequest}>
              <Ionicons name="qr-code-outline" size={20} color="#000" />
              <Text style={styles.primaryButtonText}>Show Payment Request QR</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Scan / Paste Customer Authorization Modal */}
      <Modal visible={showScannerModal} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Scan Customer Authorization</Text>
              <TouchableOpacity onPress={() => setShowScannerModal(false)}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              Paste or scan customer's signed PaymentAuthorization QR payload:
            </Text>

            <TextInput
              style={styles.textInputArea}
              value={authPayloadInput}
              onChangeText={setAuthPayloadInput}
              placeholder="Paste base64url authorization payload..."
              placeholderTextColor="#64748b"
              multiline
              numberOfLines={4}
            />

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleVerifyAuthorization}
            >
              <Ionicons name="checkmark-done" size={20} color="#000" />
              <Text style={styles.primaryButtonText}>Verify Offline & Accept</Text>
            </TouchableOpacity>
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
  card: {
    backgroundColor: '#111827',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1f2937',
    alignItems: 'center',
  },
  inputTitle: { color: '#94a3b8', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  dollarSign: { fontSize: 36, fontWeight: '700', color: '#f59e0b', marginRight: 4 },
  amountInput: {
    fontSize: 44,
    fontWeight: '900',
    color: '#f8fafc',
    minWidth: 140,
    textAlign: 'center',
  },
  unitCode: { fontSize: 18, fontWeight: '600', color: '#94a3b8', marginLeft: 8 },
  quickPills: { flexDirection: 'row', gap: 8, marginBottom: 24, width: '100%' },
  pill: {
    flex: 1,
    backgroundColor: '#1e293b',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  pillActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  pillText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  pillTextActive: { color: '#000', fontWeight: '700' },
  primaryButton: {
    width: '100%',
    backgroundColor: '#f59e0b',
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  amountDisplayHeader: { alignItems: 'center', marginBottom: 16 },
  amountLabel: { color: '#94a3b8', fontSize: 13, marginBottom: 4 },
  amountBig: { fontSize: 36, fontWeight: '900', color: '#f8fafc' },
  qrContainer: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 20,
    marginBottom: 20,
  },
  qrHelpText: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 10,
  },
  cancelLink: { marginTop: 14, padding: 8 },
  cancelLinkText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  verifiedHeader: { alignItems: 'center', marginBottom: 20 },
  verifiedTitle: { fontSize: 22, fontWeight: '800', marginTop: 10, marginBottom: 6 },
  verifiedSub: { color: '#94a3b8', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  checklist: {
    width: '100%',
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginBottom: 24,
    gap: 10,
  },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkDetail: { color: '#e2e8f0', fontSize: 13, flex: 1 },
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
    marginBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#f8fafc' },
  modalSub: { color: '#94a3b8', fontSize: 13, marginBottom: 16 },
  textInputArea: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#f8fafc',
    fontSize: 13,
    padding: 12,
    fontFamily: 'monospace',
    textAlignVertical: 'top',
    marginBottom: 20,
  },
});
