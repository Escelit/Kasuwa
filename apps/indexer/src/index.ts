import { buildIndexerApp } from './app.js';
import { loadIndexerConfig } from './config.js';
import { InMemoryKasuwaDb, createPostgresDb, IKasuwaDb } from '@kasuwa/db';
import { IngestionService, LiveSorobanRpcEventStreamer } from './ingestion.js';

export * from './bucketing.js';
export * from './ingestion.js';
export * from './app.js';

async function main(): Promise<void> {
  const config = loadIndexerConfig();

  let db: IKasuwaDb;
  if (config.DATABASE_URL && config.DATABASE_URL.startsWith('postgres')) {
    try {
      const { kasuwaDb } = createPostgresDb(config.DATABASE_URL);
      db = kasuwaDb;
      console.log('[indexer] Connected to PostgreSQL via Drizzle ORM');
    } catch (dbErr) {
      console.warn('[indexer] Failed to connect to Postgres, falling back to InMemoryKasuwaDb:', dbErr);
      db = new InMemoryKasuwaDb();
    }
  } else {
    db = new InMemoryKasuwaDb();
  }

  const streamer =
    config.SOROBAN_RPC_URL && config.VAULT_CONTRACT_ID
      ? new LiveSorobanRpcEventStreamer(config.SOROBAN_RPC_URL, config.VAULT_CONTRACT_ID)
      : undefined;

  const ingestionService = new IngestionService({ db, config, streamer });
  const app = await buildIndexerApp({ db });

  // Background polling loop if streamer is active
  if (streamer) {
    const interval = config.POLL_INTERVAL_MS;
    console.log(`[indexer] Starting Soroban RPC event polling every ${interval}ms`);
    setInterval(async () => {
      try {
        const { ingested } = await ingestionService.poll();
        if (ingested > 0) {
          console.log(`[indexer] Ingested ${ingested} on-chain event(s)`);
        }
      } catch (err) {
        console.error('[indexer] Event polling error:', err);
      }
    }, interval);
  }

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`Kasuwa indexer API listening on ${config.HOST}:${config.PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

if (process.env['NODE_ENV'] !== 'test' && !process.env['VITEST']) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
