/**
 * Merchant mode bottom-tab navigator.
 * Tabs: Receive | Outbox | Settings
 */
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ReceiveScreen } from '../features/receive/ReceiveScreen';
import { OutboxScreen } from '../features/outbox/OutboxScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type MerchantTabParamList = {
  Receive: undefined;
  Outbox: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MerchantTabParamList>();

export function MerchantNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#2d6a4f',
      }}
    >
      <Tab.Screen
        name="Receive"
        component={ReceiveScreen}
        options={{ title: 'Receive' }}
      />
      <Tab.Screen
        name="Outbox"
        component={OutboxScreen}
        options={{ title: 'Outbox' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </Tab.Navigator>
  );
}
