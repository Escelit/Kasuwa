/**
 * Customer mode bottom-tab navigator.
 * Tabs: Allowance | Pay | Settings
 */
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AllowanceScreen } from '../features/allowance/AllowanceScreen';
import { PayScreen } from '../features/pay/PayScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type CustomerTabParamList = {
  Allowance: undefined;
  Pay: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<CustomerTabParamList>();

export function CustomerNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#1a73e8',
      }}
    >
      <Tab.Screen
        name="Allowance"
        component={AllowanceScreen}
        options={{ title: 'Allowance' }}
      />
      <Tab.Screen
        name="Pay"
        component={PayScreen}
        options={{ title: 'Pay' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </Tab.Navigator>
  );
}
