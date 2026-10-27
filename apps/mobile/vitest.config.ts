/**
 * Vitest config for @kasuwa/mobile pure logic tests.
 *
 * Runs platform-agnostic modules (reducers, builders, verifiers, device key)
 * in Node — no React Native runtime needed.
 *
 * Component / hook tests that require the RN environment stay in Jest (jest-expo)
 * and are run via `pnpm test:ui`.
 */
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@kasuwa/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts'),
      '@kasuwa/risk': resolve(__dirname, '../../packages/risk/src/index.ts'),
      '@kasuwa/sdk': resolve(__dirname, '../../packages/sdk/src/index.ts'),
      '@kasuwa/ui': resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/features/**/__tests__/**/*.test.ts',
      'src/native/__tests__/**/*.test.ts',
    ],
    exclude: [
      // Component/hook tests need jest-expo; run with `pnpm test:ui`
      'src/context/__tests__/**',
    ],
  },
});
