import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Kasuwa',
  slug: 'kasuwa',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'kasuwa',
  userInterfaceStyle: 'light',
  // Custom dev client required: Expo Go does NOT support native modules
  // (Secure Enclave / Android Keystore key-store bridge).
  // Build with: expo prebuild && expo run:android / expo run:ios
  platforms: ['ios', 'android'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.kasuwa.app',
    // Biometric/Face ID usage description (required by App Store)
    infoPlist: {
      NSFaceIDUsageDescription:
        'Kasuwa uses Face ID to authorize payments with your hardware-backed signing key.',
    },
  },
  android: {
    package: 'com.kasuwa.app',
    adaptiveIcon: {
      backgroundColor: '#ffffff',
    },
    // StrongBox / TEE key store: no extra permissions required.
    // Biometric prompt is handled by BiometricPrompt API in the native module.
    permissions: ['USE_BIOMETRIC', 'USE_FINGERPRINT'],
  },
  plugins: [
    [
      'expo-sqlite',
      {
        enableFTS: false,
      },
    ],
    'expo-secure-store',
    'expo-local-authentication',
  ],
  extra: {
    // All runtime config comes from EXPO_PUBLIC_* env vars only (no secrets).
    // See: https://docs.expo.dev/guides/environment-variables/
  },
};

export default config;
