/**
 * OutboxScreen: shell for features/outbox.
 * Merchant mode: list pending/settled authorizations, pull-to-refresh, manual settle.
 * Full implementation in Commit 6.
 */
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';

export function OutboxScreen(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title} accessibilityRole="header">
          Settlement Outbox
        </Text>
        <Text style={styles.body}>
          Accepted payments waiting to be settled on-chain appear here.
        </Text>
        <Text style={styles.hint}>(Settlement queue coming in Phase 1)</Text>
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
