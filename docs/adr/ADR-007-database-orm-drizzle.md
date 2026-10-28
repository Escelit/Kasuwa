# ADR-007: Choosing Drizzle ORM for PostgreSQL Schema & Migrations

- **Status:** Accepted
- **Date:** 2026-10-28
- **Context:** Kasuwa requires a reliable, lightweight database layer (`packages/db`) for relayer settlement logs and indexer event ingestion into PostgreSQL.

## Decision

We adopt **Drizzle ORM** with node-postgres (`pg`) for defining schemas, managing migrations, and querying PostgreSQL.

## Rationale

1. **Zero Binary Engine**: Unlike Prisma, Drizzle does not require downloading platform-specific native binary query engines (such as `prisma-query-engine`). This eliminates CI cache bottlenecks, reduces container image sizes, and avoids native dependency compilation issues on diverse developer platforms (Linux, macOS, ARM64, and Docker).
2. **TypeScript-First & Lightweight**: Drizzle schemas map directly 1:1 to SQL tables, providing compile-time type safety with near-zero runtime overhead.
3. **Transparent SQL & Migrations**: Plain SQL migrations (`src/migrations/001_initial.sql`) allow direct database versioning and inspection without black-box schema diffing.
4. **Offline and Testing Ergonomics**: An in-memory repository implementation matching the Drizzle schema can be used in fast unit test suites without requiring live PostgreSQL instances.

## Consequences

- All relational schema definitions reside in `packages/db/src/schema.ts`.
- Migrations are stored in SQL files under `packages/db/src/migrations/`.
- Both `apps/relayer` and `apps/indexer` share typed access to `allowances`, `settlements`, `shortfalls`, `relayer_submissions`, and `indexer_cursor`.
