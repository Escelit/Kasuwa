/**
 * PayScreen: shell for features/pay.
 * Customer mode: scan PaymentRequest QR, confirm, sign, display authorization QR.
 * Full implementation in Commit 3.
 */
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';

export function PayScreen(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title} accessibilityRole="header">
          Pay
        </Text>
        <Text style={styles.body}>
          Scan a merchant's payment request QR code to authorize a payment.
        </Text>
        <Text style={styles.hint}>(Offline-first QR flow coming in Phase 1)</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12, color: '#111' },
  body: { fontSize: 15, color: '#555', textAlign: 'center' },
  hint: { marginTop: 8, fontSize: 13, color: '#aaa', textAlign: 'center' },
});
