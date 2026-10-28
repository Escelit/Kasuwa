/**
 * Relayer configuration: validated at startup with zod.
 * All values come from environment variables.
 */
import { z } from 'zod';

const RelayerConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),

  // Stellar / Soroban
  STELLAR_NETWORK: z.enum(['local', 'testnet', 'mainnet']).default('testnet'),
  STELLAR_NETWORK_PASSPHRASE: z.string().min(1),
  SOROBAN_RPC_URL: z.string().url(),
  VAULT_CONTRACT_ID: z.string().min(1),

  // Database
  DATABASE_URL: z.string().min(1),

  // Queue
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Auth — comma-separated list of API keys
  RELAYER_API_KEYS: z.string().min(1),

  // Channel accounts & fee-bump (settlement)
  RELAYER_CHANNEL_ACCOUNTS: z.coerce.number().int().min(1).default(3),
  RELAYER_CHANNEL_SECRETS: z.string().optional(),
  RELAYER_FEE_PAYER_SECRET: z.string().optional(),
  RELAYER_KMS_KEY_ID: z.string().optional(),

  // Sentry (optional)
  SENTRY_DSN: z.string().optional(),

  // Validation limits (AllowanceVault::MAX_BATCH_SIZE = 25)
  MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
});

export type RelayerConfig = z.infer<typeof RelayerConfigSchema>;

let _config: RelayerConfig | null = null;

export function loadConfig(): RelayerConfig {
  if (_config) return _config;
  const result = RelayerConfigSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Relayer configuration error:\n${result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  _config = result.data;
  return _config;
}

/** Parses the RELAYER_API_KEYS env var into a Set for O(1) lookup. */
export function parseApiKeys(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  );
}
