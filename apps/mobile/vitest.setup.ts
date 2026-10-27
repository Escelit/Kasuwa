/**
 * Vitest setup for @kasuwa/mobile pure logic tests.
 * Mocks native modules that are unavailable in Node.
 */
import { vi } from 'vitest';

// In-memory store simulating expo-secure-store for tests.
// NOT cleared between tests — each test file manages its own key lifecycle
// via SoftwareDeviceKey.delete() in afterAll/afterEach as needed.
const memStore = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(async (key: string, value: string) => {
    memStore.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => memStore.get(key) ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    memStore.delete(key);
  }),
}));

// Ensure __DEV__ is defined (React Native global, must be true so
// SoftwareDeviceKey doesn't throw HARDWARE_UNAVAILABLE).
if (typeof (global as Record<string, unknown>).__DEV__ === 'undefined') {
  (global as Record<string, unknown>).__DEV__ = true;
}
