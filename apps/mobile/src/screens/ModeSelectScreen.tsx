/**
 * ModeSelectScreen: shown at first launch when no mode has been chosen.
 * Lets the user pick Customer or Merchant mode.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useAppMode } from '../context/AppModeContext';

export function ModeSelectScreen(): React.JSX.Element {
  const { setMode } = useAppMode();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title} accessibilityRole="header">
          Welcome to Kasuwa
        </Text>
        <Text style={styles.subtitle}>
          How will you use this device?
        </Text>
        <Text style={styles.hint}>
          You can change this at any time in Settings.
        </Text>

        <TouchableOpacity
          style={[styles.button, styles.customerButton]}
          onPress={() => setMode('customer')}
          accessibilityLabel="Use as Customer"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>💳  I'm a Customer</Text>
          <Text style={styles.buttonSub}>
            Create an allowance and pay merchants
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.merchantButton]}
          onPress={() => setMode('merchant')}
          accessibilityLabel="Use as Merchant"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>🏪  I'm a Merchant</Text>
          <Text style={styles.buttonSub}>
            Accept payments and settle them later
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    color: '#111',
  },
  subtitle: {
    fontSize: 18,
    color: '#444',
    marginBottom: 4,
  },
  hint: {
    fontSize: 13,
    color: '#888',
    marginBottom: 40,
  },
  button: {
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  customerButton: { backgroundColor: '#e8f0fe' },
  merchantButton: { backgroundColor: '#e8f5e9' },
  buttonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111',
  },
  buttonSub: {
    fontSize: 13,
    color: '#555',
    marginTop: 4,
  },
});
