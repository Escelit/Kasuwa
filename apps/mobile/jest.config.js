// Jest config for @kasuwa/mobile
// Uses jest-expo preset which handles React Native transforms and Hermes.
// @see https://docs.expo.dev/guides/testing-with-jest/

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    // Transform everything in node_modules EXCEPT these packages that ship
    // ES modules or Flow types that must be transpiled by Babel.
    'node_modules/(?!' + [
      '(jest-)?react-native',
      '@react-native(-community)?',
      '@react-native/js-polyfills',
      'expo(nent)?',
      '@expo(nent)?/.*',
      '@expo-google-fonts/.*',
      'react-navigation',
      '@react-navigation/.*',
      '@unimodules/.*',
      'unimodules',
      'sentry-expo',
      'native-base',
      'react-native-svg',
    ].join('|') + ')',
  ],
  moduleNameMapper: {
    // Map workspace packages to their source for tests (avoids needing dist/)
    '^@kasuwa/protocol$': '<rootDir>/../../packages/protocol/src/index.ts',
    '^@kasuwa/risk$': '<rootDir>/../../packages/risk/src/index.ts',
    '^@kasuwa/sdk$': '<rootDir>/../../packages/sdk/src/index.ts',
    '^@kasuwa/ui$': '<rootDir>/../../packages/ui/src/index.ts',
  },
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.ts?(x)',
    '<rootDir>/src/**/*.test.ts?(x)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
};
