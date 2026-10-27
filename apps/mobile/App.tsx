/**
 * App entry point.
 * Renders the root navigation container with mode awareness.
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AppModeProvider } from './src/context/AppModeContext';

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppModeProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </AppModeProvider>
    </SafeAreaProvider>
  );
}
