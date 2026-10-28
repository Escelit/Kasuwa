/**
 * Runtime environment configuration for the Kasuwa mobile app.
 *
 * All config comes from EXPO_PUBLIC_* environment variables only.
 * These are injected at build time by Expo and are safe for the client bundle
 * (never put secrets here).
 *
 * @see https://docs.expo.dev/guides/environment-variables/
 */

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Set it in .env.local as ${key}=... (must be prefixed EXPO_PUBLIC_).`,
    );
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export interface AppConfig {
  /** Stellar network identifier: 'local' | 'testnet' | 'mainnet' */
  network: string;
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Stellar network passphrase (also feeds network_id for signing) */
  networkPassphrase: string;
  /** Deployed AllowanceVault contract address */
  vaultContractId: string;
  /** Default token contract address (e.g. USDC SAC) */
  tokenContractId: string;
  /** Relayer API base URL (used by outbox for settlement) */
  relayerUrl: string;
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (_config !== null) return _config;

  _config = {
    network: optionalEnv('EXPO_PUBLIC_STELLAR_NETWORK', 'testnet'),
    rpcUrl: optionalEnv(
      'EXPO_PUBLIC_SOROBAN_RPC_URL',
      'https://soroban-testnet.stellar.org',
    ),
    networkPassphrase: optionalEnv(
      'EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE',
      'Test SDF Network ; September 2015',
    ),
    vaultContractId: optionalEnv('EXPO_PUBLIC_VAULT_CONTRACT_ID', ''),
    tokenContractId: optionalEnv('EXPO_PUBLIC_TOKEN_CONTRACT_ID', ''),
    relayerUrl: optionalEnv('EXPO_PUBLIC_RELAYER_URL', 'http://localhost:3001'),
  };

  return _config;
}
