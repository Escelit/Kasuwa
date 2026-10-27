/**
 * Tests for AppModeContext: mode persistence and switching.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AppModeProvider, useAppMode } from '../AppModeContext';
import * as SecureStore from 'expo-secure-store';

function ModeDisplay(): React.JSX.Element {
  const { mode, loading } = useAppMode();
  if (loading) return <Text testID="loading">loading</Text>;
  return <Text testID="mode">{mode ?? 'null'}</Text>;
}

describe('AppModeContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts loading then resolves to null when no stored mode', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    const { getByTestId } = render(
      <AppModeProvider><ModeDisplay /></AppModeProvider>,
    );
    expect(getByTestId('loading')).toBeTruthy();
    await waitFor(() => expect(getByTestId('mode').props.children).toBe('null'));
  });

  it('restores persisted customer mode', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('customer');
    const { getByTestId } = render(
      <AppModeProvider><ModeDisplay /></AppModeProvider>,
    );
    await waitFor(() => expect(getByTestId('mode').props.children).toBe('customer'));
  });

  it('restores persisted merchant mode', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('merchant');
    const { getByTestId } = render(
      <AppModeProvider><ModeDisplay /></AppModeProvider>,
    );
    await waitFor(() => expect(getByTestId('mode').props.children).toBe('merchant'));
  });

  it('ignores unexpected stored value, falls back to null', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('bogus');
    const { getByTestId } = render(
      <AppModeProvider><ModeDisplay /></AppModeProvider>,
    );
    await waitFor(() => expect(getByTestId('mode').props.children).toBe('null'));
  });

  it('persists mode when setMode is called', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);

    function Switcher(): React.JSX.Element {
      const { mode, setMode } = useAppMode();
      return (
        <>
          <Text testID="mode">{mode ?? 'null'}</Text>
          <Text testID="switch" onPress={() => { void setMode('customer'); }} />
        </>
      );
    }

    const { getByTestId } = render(
      <AppModeProvider><Switcher /></AppModeProvider>,
    );
    await waitFor(() => expect(getByTestId('mode').props.children).toBe('null'));
    await act(async () => { getByTestId('switch').props.onPress(); });
    await waitFor(() => expect(getByTestId('mode').props.children).toBe('customer'));
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('kasuwa:app_mode', 'customer');
  });

  it('throws when used outside provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ModeDisplay />)).toThrow(
      'useAppMode must be used within an AppModeProvider',
    );
    spy.mockRestore();
  });
});
