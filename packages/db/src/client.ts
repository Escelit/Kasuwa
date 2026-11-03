import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, gte, sql, desc } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';

export * from './schema.js';

export interface AllowanceRecord {
  id: string;
  owner: string;
  token: string;
  deviceKeyHex: string;
  balance: string;
  perPaymentCap: string;
  validUntil: number;
  closeRequestedAt?: number | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface SettlementRow {
  id?: number;
  paymentId: string;
  allowanceId: string;
  merchant: string;
  amount: string;
  expiresAt: number;
  status: string;
  paid?: string | null;
  shortfall?: string | null;
  onChainResult?: string | null;
  rawBytes?: string | null;
  attempts?: number;
  lastError?: string | null;
  acceptedAt: number;
  updatedAt: number;
}

export interface ShortfallRow {
  id?: number;
  deviceKeyHex: string;
  allowanceId: string;
  merchant: string;
  amount: string;
  timestamp: number;
}

export interface IndexerCursorRow {
  lastLedger: number;
  lastCursor: string;
  updatedAt: number;
}

export interface IKasuwaDb {
  allowances: {
    get(id: string): Promise<AllowanceRecord | null>;
    upsert(record: AllowanceRecord): Promise<void>;
    updateBalance(id: string, balance: string): Promise<void>;
    updateStatus(id: string, status: string, closeRequestedAt?: number | null): Promise<void>;
    listSnapshots(since?: number): Promise<AllowanceRecord[]>;
  };
  settlements: {
    get(paymentId: string): Promise<SettlementRow | null>;
    upsert(record: SettlementRow): Promise<void>;
    listByMerchant(
      merchant: string,
      limit?: number,
      offset?: number,
    ): Promise<{ items: SettlementRow[]; total: number }>;
  };
  shortfalls: {
    record(row: ShortfallRow): Promise<void>;
    listByDeviceKey(deviceKeyHex: string): Promise<ShortfallRow[]>;
    countForDeviceKey(deviceKeyHex: string): Promise<{ count: number; totalAmount: string }>;
  };
  cursor: {
    get(): Promise<IndexerCursorRow | null>;
    set(lastLedger: number, lastCursor: string): Promise<void>;
  };
}

/**
 * In-memory implementation of IKasuwaDb for robust unit testing without requiring live Postgres.
 */
export class InMemoryKasuwaDb implements IKasuwaDb {
  private allowancesMap = new Map<string, AllowanceRecord>();
  private settlementsMap = new Map<string, SettlementRow>();
  private shortfallsList: ShortfallRow[] = [];
  private cursorRow: IndexerCursorRow | null = null;

  allowances = {
    get: async (id: string) => this.allowancesMap.get(id) ?? null,
    upsert: async (record: AllowanceRecord) => {
      this.allowancesMap.set(record.id, { ...record });
    },
    updateBalance: async (id: string, balance: string) => {
      const existing = this.allowancesMap.get(id);
      if (existing) {
        existing.balance = balance;
        existing.updatedAt = Math.floor(Date.now() / 1000);
      }
    },
    updateStatus: async (id: string, status: string, closeRequestedAt?: number | null) => {
      const existing = this.allowancesMap.get(id);
      if (existing) {
        existing.status = status;
        if (closeRequestedAt !== undefined) {
          existing.closeRequestedAt = closeRequestedAt;
        }
        existing.updatedAt = Math.floor(Date.now() / 1000);
      }
    },
    listSnapshots: async (since?: number) => {
      const all = Array.from(this.allowancesMap.values());
      if (since === undefined || since === 0) return all;
      return all.filter((a) => a.updatedAt >= since);
    },
  };

  settlements = {
    get: async (paymentId: string) => this.settlementsMap.get(paymentId) ?? null,
    upsert: async (record: SettlementRow) => {
      this.settlementsMap.set(record.paymentId, { ...record });
    },
    listByMerchant: async (merchant: string, limit = 50, offset = 0) => {
      const filtered = Array.from(this.settlementsMap.values()).filter(
        (s) => s.merchant.toLowerCase() === merchant.toLowerCase(),
      );
      // Sort by acceptedAt desc
      filtered.sort((a, b) => b.acceptedAt - a.acceptedAt);
      return {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
      };
    },
  };

  shortfalls = {
    record: async (row: ShortfallRow) => {
      this.shortfallsList.push({ ...row, id: this.shortfallsList.length + 1 });
    },
    listByDeviceKey: async (deviceKeyHex: string) => {
      return this.shortfallsList.filter((s) => s.deviceKeyHex.toLowerCase() === deviceKeyHex.toLowerCase());
    },
    countForDeviceKey: async (deviceKeyHex: string) => {
      const matches = this.shortfallsList.filter(
        (s) => s.deviceKeyHex.toLowerCase() === deviceKeyHex.toLowerCase(),
      );
      let total = 0n;
      for (const m of matches) {
        total += BigInt(m.amount);
      }
      return {
        count: matches.length,
        totalAmount: total.toString(),
      };
    },
  };

  cursor = {
    get: async () => (this.cursorRow ? { ...this.cursorRow } : null),
    set: async (lastLedger: number, lastCursor: string) => {
      this.cursorRow = {
        lastLedger,
        lastCursor,
        updatedAt: Math.floor(Date.now() / 1000),
      };
    },
  };

  clear() {
    this.allowancesMap.clear();
    this.settlementsMap.clear();
    this.shortfallsList = [];
    this.cursorRow = null;
  }
}

/**
 * Production implementation of IKasuwaDb backed by PostgreSQL via Drizzle ORM.
 */
export class PostgresKasuwaDb implements IKasuwaDb {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  allowances = {
    get: async (id: string): Promise<AllowanceRecord | null> => {
      const res = await this.db
        .select()
        .from(schema.allowances)
        .where(eq(schema.allowances.id, id))
        .limit(1);
      if (!res.length) return null;
      const row = res[0]!;
      return {
        id: row.id,
        owner: row.owner,
        token: row.token,
        deviceKeyHex: row.deviceKeyHex,
        balance: row.balance,
        perPaymentCap: row.perPaymentCap,
        validUntil: Number(row.validUntil),
        closeRequestedAt: row.closeRequestedAt ? Number(row.closeRequestedAt) : null,
        status: row.status,
        createdAt: Number(row.createdAt),
        updatedAt: Number(row.updatedAt),
      };
    },
    upsert: async (record: AllowanceRecord): Promise<void> => {
      await this.db
        .insert(schema.allowances)
        .values({
          id: record.id,
          owner: record.owner,
          token: record.token,
          deviceKeyHex: record.deviceKeyHex,
          balance: record.balance,
          perPaymentCap: record.perPaymentCap,
          validUntil: record.validUntil,
          closeRequestedAt: record.closeRequestedAt ?? null,
          status: record.status,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        })
        .onConflictDoUpdate({
          target: schema.allowances.id,
          set: {
            balance: record.balance,
            perPaymentCap: record.perPaymentCap,
            validUntil: record.validUntil,
            closeRequestedAt: record.closeRequestedAt ?? null,
            status: record.status,
            updatedAt: record.updatedAt,
          },
        });
    },
    updateBalance: async (id: string, balance: string): Promise<void> => {
      const now = Math.floor(Date.now() / 1000);
      await this.db
        .update(schema.allowances)
        .set({ balance, updatedAt: now })
        .where(eq(schema.allowances.id, id));
    },
    updateStatus: async (
      id: string,
      status: string,
      closeRequestedAt?: number | null,
    ): Promise<void> => {
      const now = Math.floor(Date.now() / 1000);
      const updateData: { status: string; updatedAt: number; closeRequestedAt?: number | null } = {
        status,
        updatedAt: now,
      };
      if (closeRequestedAt !== undefined) {
        updateData.closeRequestedAt = closeRequestedAt;
      }
      await this.db
        .update(schema.allowances)
        .set(updateData)
        .where(eq(schema.allowances.id, id));
    },
    listSnapshots: async (since?: number): Promise<AllowanceRecord[]> => {
      let query = this.db.select().from(schema.allowances);
      const rows =
        since !== undefined && since > 0
          ? await query.where(gte(schema.allowances.updatedAt, since))
          : await query;
      return rows.map((r) => ({
        id: r.id,
        owner: r.owner,
        token: r.token,
        deviceKeyHex: r.deviceKeyHex,
        balance: r.balance,
        perPaymentCap: r.perPaymentCap,
        validUntil: Number(r.validUntil),
        closeRequestedAt: r.closeRequestedAt ? Number(r.closeRequestedAt) : null,
        status: r.status,
        createdAt: Number(r.createdAt),
        updatedAt: Number(r.updatedAt),
      }));
    },
  };

  settlements = {
    get: async (paymentId: string): Promise<SettlementRow | null> => {
      const res = await this.db
        .select()
        .from(schema.settlements)
        .where(eq(schema.settlements.paymentId, paymentId))
        .limit(1);
      if (!res.length) return null;
      const r = res[0]!;
      return {
        id: r.id,
        paymentId: r.paymentId,
        allowanceId: r.allowanceId,
        merchant: r.merchant,
        amount: r.amount,
        expiresAt: Number(r.expiresAt),
        status: r.status,
        paid: r.paid,
        shortfall: r.shortfall,
        onChainResult: r.onChainResult,
        rawBytes: r.rawBytes,
        attempts: r.attempts,
        lastError: r.lastError,
        acceptedAt: Number(r.acceptedAt),
        updatedAt: Number(r.updatedAt),
      };
    },
    upsert: async (record: SettlementRow): Promise<void> => {
      await this.db
        .insert(schema.settlements)
        .values({
          paymentId: record.paymentId,
          allowanceId: record.allowanceId,
          merchant: record.merchant,
          amount: record.amount,
          expiresAt: record.expiresAt,
          status: record.status,
          paid: record.paid ?? null,
          shortfall: record.shortfall ?? null,
          onChainResult: record.onChainResult ?? null,
          rawBytes: record.rawBytes ?? null,
          attempts: record.attempts ?? 0,
          lastError: record.lastError ?? null,
          acceptedAt: record.acceptedAt,
          updatedAt: record.updatedAt,
        })
        .onConflictDoUpdate({
          target: schema.settlements.paymentId,
          set: {
            status: record.status,
            paid: record.paid ?? null,
            shortfall: record.shortfall ?? null,
            onChainResult: record.onChainResult ?? null,
            attempts: record.attempts ?? 0,
            lastError: record.lastError ?? null,
            updatedAt: record.updatedAt,
          },
        });
    },
    listByMerchant: async (
      merchant: string,
      limit = 50,
      offset = 0,
    ): Promise<{ items: SettlementRow[]; total: number }> => {
      const condition = eq(schema.settlements.merchant, merchant);
      const totalRes = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(schema.settlements)
        .where(condition);
      const total = Number(totalRes[0]?.count ?? 0);

      const rows = await this.db
        .select()
        .from(schema.settlements)
        .where(condition)
        .orderBy(desc(schema.settlements.acceptedAt))
        .limit(limit)
        .offset(offset);

      return {
        items: rows.map((r) => ({
          id: r.id,
          paymentId: r.paymentId,
          allowanceId: r.allowanceId,
          merchant: r.merchant,
          amount: r.amount,
          expiresAt: Number(r.expiresAt),
          status: r.status,
          paid: r.paid,
          shortfall: r.shortfall,
          onChainResult: r.onChainResult,
          rawBytes: r.rawBytes,
          attempts: r.attempts,
          lastError: r.lastError,
          acceptedAt: Number(r.acceptedAt),
          updatedAt: Number(r.updatedAt),
        })),
        total,
      };
    },
  };

  shortfalls = {
    record: async (row: ShortfallRow): Promise<void> => {
      await this.db.insert(schema.shortfalls).values({
        deviceKeyHex: row.deviceKeyHex,
        allowanceId: row.allowanceId,
        merchant: row.merchant,
        amount: row.amount,
        timestamp: row.timestamp,
      });
    },
    listByDeviceKey: async (deviceKeyHex: string): Promise<ShortfallRow[]> => {
      const rows = await this.db
        .select()
        .from(schema.shortfalls)
        .where(eq(schema.shortfalls.deviceKeyHex, deviceKeyHex));
      return rows.map((r) => ({
        id: r.id,
        deviceKeyHex: r.deviceKeyHex,
        allowanceId: r.allowanceId,
        merchant: r.merchant,
        amount: r.amount,
        timestamp: Number(r.timestamp),
      }));
    },
    countForDeviceKey: async (
      deviceKeyHex: string,
    ): Promise<{ count: number; totalAmount: string }> => {
      const res = await this.db
        .select({
          count: sql<number>`count(*)`,
          totalAmount: sql<string>`coalesce(sum(${schema.shortfalls.amount}), 0)`,
        })
        .from(schema.shortfalls)
        .where(eq(schema.shortfalls.deviceKeyHex, deviceKeyHex));
      return {
        count: Number(res[0]?.count ?? 0),
        totalAmount: (res[0]?.totalAmount ?? '0').toString(),
      };
    },
  };

  cursor = {
    get: async (): Promise<IndexerCursorRow | null> => {
      const res = await this.db
        .select()
        .from(schema.indexerCursor)
        .where(eq(schema.indexerCursor.id, 1))
        .limit(1);
      if (!res.length) return null;
      return {
        lastLedger: Number(res[0]!.lastLedger),
        lastCursor: res[0]!.lastCursor,
        updatedAt: Number(res[0]!.updatedAt),
      };
    },
    set: async (lastLedger: number, lastCursor: string): Promise<void> => {
      const now = Math.floor(Date.now() / 1000);
      await this.db
        .insert(schema.indexerCursor)
        .values({
          id: 1,
          lastLedger,
          lastCursor,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.indexerCursor.id,
          set: {
            lastLedger,
            lastCursor,
            updatedAt: now,
          },
        });
    },
  };
}

/**
 * Creates a live Postgres Drizzle DB client and returns the IKasuwaDb instance.
 */
export function createPostgresDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  const kasuwaDb = new PostgresKasuwaDb(db);
  return { pool, db, kasuwaDb };
}
