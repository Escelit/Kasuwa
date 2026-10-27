/**
 * AppModeContext: Customer vs Merchant mode selection.
 *
 * Mode is persisted in AsyncStorage / SecureStore so it survives restarts.
 * Chosen at first launch on the ModeSelect screen; switchable from Settings.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';

export type AppMode = 'customer' | 'merchant' | null;

const MODE_STORAGE_KEY = 'kasuwa:app_mode';

interface AppModeContextValue {
  mode: AppMode;
  /** True while loading the persisted mode from storage */
  loading: boolean;
  setMode: (mode: 'customer' | 'merchant') => Promise<void>;
}

const AppModeContext = createContext<AppModeContextValue | null>(null);

export function AppModeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [mode, setModeState] = useState<AppMode>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(MODE_STORAGE_KEY)
      .then((stored) => {
        if (stored === 'customer' || stored === 'merchant') {
          setModeState(stored);
        }
      })
      .catch(() => {
        // Storage unavailable (e.g., test env) — default to null (shows mode select)
      })
      .finally(() => setLoading(false));
  }, []);

  const setMode = useCallback(async (newMode: 'customer' | 'merchant') => {
    await SecureStore.setItemAsync(MODE_STORAGE_KEY, newMode);
    setModeState(newMode);
  }, []);

  return (
    <AppModeContext.Provider value={{ mode, loading, setMode }}>
      {children}
    </AppModeContext.Provider>
  );
}

export function useAppMode(): AppModeContextValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) {
    throw new Error('useAppMode must be used within an AppModeProvider');
  }
  return ctx;
}
