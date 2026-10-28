import { buildIndexerApp } from './app.js';
import { loadIndexerConfig } from './config.js';
import { InMemoryKasuwaDb } from '@kasuwa/db';

export * from './bucketing.js';
export * from './ingestion.js';
export * from './app.js';

async function main(): Promise<void> {
  const config = loadIndexerConfig();
  const db = new InMemoryKasuwaDb(); // In production with DATABASE_URL, instantiate live Drizzle db
  const app = await buildIndexerApp({ db });

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
