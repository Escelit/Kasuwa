import { drizzle } from 'drizzle-orm/node-postgres';
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
 * Creates a live Postgres Drizzle DB client.
 */
export function createPostgresDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
