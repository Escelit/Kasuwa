import { z } from 'zod';

const IndexerConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  HOST: z.string().default('0.0.0.0'),

  // Stellar / Soroban
  STELLAR_NETWORK: z.enum(['local', 'testnet', 'mainnet']).default('testnet'),
  SOROBAN_RPC_URL: z.string().url(),
  VAULT_CONTRACT_ID: z.string().min(1),

  // Database
  DATABASE_URL: z.string().min(1),

  // Confirmation depth for Stellar SCP finality (1 ledger is final on Stellar)
  CONFIRMATION_DEPTH: z.coerce.number().int().min(1).default(1),

  // Optional manual backfill starting ledger
  START_LEDGER: z.coerce.number().int().optional(),
});

export type IndexerConfig = z.infer<typeof IndexerConfigSchema>;

let _config: IndexerConfig | null = null;

export function loadIndexerConfig(): IndexerConfig {
  if (_config) return _config;
  const result = IndexerConfigSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Indexer configuration error:\n${result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  _config = result.data;
  return _config;
}
