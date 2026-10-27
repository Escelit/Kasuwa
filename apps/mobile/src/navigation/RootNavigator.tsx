/**
 * RootNavigator: top-level stack.
 *
 * - No mode chosen yet → ModeSelectScreen
 * - customer             → CustomerTabNavigator
 * - merchant             → MerchantTabNavigator
 */
import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppMode } from '../context/AppModeContext';
import { ModeSelectScreen } from '../screens/ModeSelectScreen';
import { CustomerNavigator } from './CustomerNavigator';
import { MerchantNavigator } from './MerchantNavigator';

export type RootStackParamList = {
  ModeSelect: undefined;
  Customer: undefined;
  Merchant: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): React.JSX.Element {
  const { mode, loading } = useAppMode();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" accessibilityLabel="Loading Kasuwa" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {mode === null && (
        <Stack.Screen name="ModeSelect" component={ModeSelectScreen} />
      )}
      {mode === 'customer' && (
        <Stack.Screen name="Customer" component={CustomerNavigator} />
      )}
      {mode === 'merchant' && (
        <Stack.Screen name="Merchant" component={MerchantNavigator} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
