/**
 * DeviceKey module entry point.
 *
 * Exports the platform-appropriate implementation:
 * - On a real device: NativeDeviceKey (Secure Enclave / Android Keystore).
 * - In __DEV__ (simulator / CI): SoftwareDeviceKey fallback.
 *
 * The NativeDeviceKey is conditionally required so the native module
 * is only linked when actually needed. This avoids build errors in
 * environments where the native module is not compiled (e.g., bare Jest).
 */
import { SoftwareDeviceKey } from './SoftwareDeviceKey.js';
import { type DeviceKey as IDeviceKey, DeviceKeyError, DeviceKeyErrorCode } from './DeviceKeyInterface.js';

export { DeviceKeyError, DeviceKeyErrorCode };
export type { IDeviceKey as DeviceKeyInterface };

/**
 * Attempt to load the native module. Returns null in environments where
 * native modules are not available (Jest, Expo Go, CI).
 */
function tryLoadNative(): IDeviceKey | null {
  if (__DEV__) return null; // always use software in dev / simulator
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('./KasuwaKeyModule') as { KasuwaKeyModule: IDeviceKey };
    return mod.KasuwaKeyModule;
  } catch {
    return null;
  }
}

const _native = tryLoadNative();

/**
 * The active DeviceKey implementation.
 *
 * In __DEV__ or when native modules are unavailable, this is SoftwareDeviceKey.
 * In release builds on real hardware, this is the native Keystore / Secure Enclave module.
 */
export const DeviceKey: IDeviceKey = _native ?? SoftwareDeviceKey;

/**
 * True if the active implementation is the software fallback.
 * Use this in UI to display a "software signing" warning badge.
 */
export const isSoftwareFallback: boolean = _native === null;
