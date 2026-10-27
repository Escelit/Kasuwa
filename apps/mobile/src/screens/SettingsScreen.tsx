/**
 * SettingsScreen: switch mode, view app info.
 * Available in both Customer and Merchant navigators.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useAppMode } from '../context/AppModeContext';

export function SettingsScreen(): React.JSX.Element {
  const { mode, setMode } = useAppMode();

  function confirmSwitchMode(): void {
    const target = mode === 'customer' ? 'merchant' : 'customer';
    Alert.alert(
      'Switch mode?',
      `Switch to ${target} mode? Your local data stays intact.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: () => setMode(target),
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.heading} accessibilityRole="header">
          Settings
        </Text>

        <View style={styles.row}>
          <Text style={styles.label}>Current mode</Text>
          <Text style={styles.value}>
            {mode === 'customer' ? '💳 Customer' : '🏪 Merchant'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.switchButton}
          onPress={confirmSwitchMode}
          accessibilityLabel="Switch app mode"
          accessibilityRole="button"
        >
          <Text style={styles.switchButtonText}>
            Switch to {mode === 'customer' ? 'Merchant' : 'Customer'} mode
          </Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <Text style={styles.version}>Kasuwa v0.1.0 · Pre-alpha</Text>
        <Text style={styles.network}>
          Network: {process.env['EXPO_PUBLIC_STELLAR_NETWORK'] ?? 'testnet'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, padding: 24 },
  heading: { fontSize: 24, fontWeight: '700', marginBottom: 24, color: '#111' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  label: { fontSize: 15, color: '#444' },
  value: { fontSize: 15, fontWeight: '600', color: '#111' },
  switchButton: {
    marginTop: 24,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  switchButtonText: { fontSize: 15, fontWeight: '600', color: '#333' },
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 24 },
  version: { fontSize: 13, color: '#888' },
  network: { fontSize: 13, color: '#888', marginTop: 4 },
});
