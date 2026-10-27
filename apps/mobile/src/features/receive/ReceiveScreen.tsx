/**
 * ReceiveScreen: shell for features/receive.
 * Merchant mode: create payment requests, scan authorizations, verify offline.
 * Full implementation in Commit 5.
 */
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';

export function ReceiveScreen(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title} accessibilityRole="header">
          Receive Payment
        </Text>
        <Text style={styles.body}>
          Create a payment request and scan the customer's authorization QR code.
        </Text>
        <Text style={styles.hint}>(Offline-first receive flow coming in Phase 1)</Text>
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
