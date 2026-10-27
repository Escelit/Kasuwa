/**
 * KasuwaKeyModule.ts — JS bridge to the native iOS / Android key module.
 *
 * The native modules return byte arrays as number[] (each byte 0–255).
 * DER signature from native → this module calls derToRaw + normalizeLowS
 * from @kasuwa/protocol so callers always receive raw 64-byte r||s low-S.
 *
 * This file is only loaded in release builds (or when __DEV__ is false).
 * In development, DeviceKey.ts falls back to SoftwareDeviceKey.
 */
import { NativeModules, Platform } from 'react-native';
import { derToRaw, normalizeLowS } from '@kasuwa/protocol';
import {
  type DeviceKey,
  DeviceKeyError,
  DeviceKeyErrorCode,
} from './DeviceKeyInterface';

interface NativeKeyModule {
  generate(
    alias: string,
    requireBiometric: boolean,
  ): Promise<{ publicKey: number[] }>;
  sign(
    alias: string,
    digest: number[],
    prompt: string,
  ): Promise<number[]>;
  exists(alias: string): Promise<boolean>;
  delete(alias: string): Promise<void>;
}

const native: NativeKeyModule | undefined =
  NativeModules['KasuwaKeyModule'] as NativeKeyModule | undefined;

function mapNativeError(err: unknown): never {
  const e = err as { code?: string; message?: string };
  const code = e.code ?? 'PLATFORM_ERROR';
  const msg = e.message ?? String(err);

  const codeMap: Record<string, DeviceKeyErrorCode> = {
    KEY_NOT_FOUND: DeviceKeyErrorCode.KEY_NOT_FOUND,
    AUTH_FAILED: DeviceKeyErrorCode.AUTH_FAILED,
    KEY_INVALIDATED: DeviceKeyErrorCode.KEY_INVALIDATED,
    INVALID_DIGEST: DeviceKeyErrorCode.INVALID_DIGEST,
    PLATFORM_ERROR: DeviceKeyErrorCode.PLATFORM_ERROR,
  };

  throw new DeviceKeyError(
    codeMap[code] ?? DeviceKeyErrorCode.PLATFORM_ERROR,
    msg,
  );
}

export const KasuwaKeyModule: DeviceKey = {
  async generate(
    alias: string,
    opts: { requireBiometric: boolean },
  ): Promise<{ publicKey: Uint8Array }> {
    if (!native) {
      throw new DeviceKeyError(
        DeviceKeyErrorCode.HARDWARE_UNAVAILABLE,
        'KasuwaKeyModule native module not found. Is the app built with expo prebuild?',
      );
    }
    try {
      const result = await native.generate(alias, opts.requireBiometric);
      return { publicKey: new Uint8Array(result.publicKey) };
    } catch (err) {
      mapNativeError(err);
    }
  },

  async sign(
    alias: string,
    digest: Uint8Array,
    prompt: string,
  ): Promise<Uint8Array> {
    if (!native) {
      throw new DeviceKeyError(
        DeviceKeyErrorCode.HARDWARE_UNAVAILABLE,
        'KasuwaKeyModule native module not found.',
      );
    }
    if (digest.length !== 32) {
      throw new DeviceKeyError(
        DeviceKeyErrorCode.INVALID_DIGEST,
        `digest must be 32 bytes, got ${digest.length}`,
      );
    }
    try {
      const derBytes = await native.sign(alias, Array.from(digest), prompt);
      const raw = derToRaw(new Uint8Array(derBytes));
      return normalizeLowS(raw);
    } catch (err) {
      if (err instanceof DeviceKeyError) throw err;
      mapNativeError(err);
    }
  },

  async exists(alias: string): Promise<boolean> {
    if (!native) return false;
    try {
      return await native.exists(alias);
    } catch {
      return false;
    }
  },

  async delete(alias: string): Promise<void> {
    if (!native) return;
    try {
      await native.delete(alias);
    } catch (err) {
      mapNativeError(err);
    }
  },
};
