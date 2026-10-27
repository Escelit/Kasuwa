/**
 * AllowanceScreen: shell for features/allowance.
 * Customer mode: manage allowances (create, view, top up, reclaim).
 * Full implementation in Commit 3.
 */
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';

export function AllowanceScreen(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title} accessibilityRole="header">
          Allowances
        </Text>
        <Text style={styles.body}>
          Create and manage your offline payment allowances here.
        </Text>
        <Text style={styles.hint}>(Full UI coming in Phase 1)</Text>
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
