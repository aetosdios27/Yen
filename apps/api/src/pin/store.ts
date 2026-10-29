import crypto from "node:crypto";
import type { CreateApprovalPinInput, Sql, SqlClient, UpdateApprovalPinInput } from "@yen/db";
import {
  createApprovalPin,
  deleteApprovalPin,
  getApprovalPin,
  type UserApprovalPinRow,
  updateApprovalPin,
  withLockedApprovalPin,
} from "@yen/db";

export interface PinRecord {
  readonly userId: string;
  readonly salt: string;
  readonly pinHash: string;
  readonly failedAttempts: number;
  readonly totalFailed24h: number;
  readonly firstFailedAt: number | null;
  readonly lockedUntil: number | null;
  readonly coolingOffUntil: number | null;
  readonly status: "active" | "locked_out" | "cooling_off";
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type NewPinRecord = Omit<PinRecord, "createdAt" | "updatedAt">;
export type PinRecordUpdate = Partial<Omit<PinRecord, "userId" | "createdAt">>;

export interface LockedPinTransaction {
  create(record: NewPinRecord): Promise<PinRecord>;
  update(updates: PinRecordUpdate): Promise<PinRecord>;
}

export interface PinStore {
  get(userId: string): Promise<PinRecord | null>;
  create(record: NewPinRecord): Promise<PinRecord>;
  update(userId: string, updates: PinRecordUpdate): Promise<PinRecord>;
  delete(userId: string): Promise<void>;
  /**
   * Runs `work` with exclusive access to one user's PIN record. The record passed in is read
   * after the lock is held, and writes made through the transaction commit together. Anything
   * thrown by `work` discards those writes, so callers return rejections as values instead.
   */
  withLock<T>(
    userId: string,
    work: (record: PinRecord | null, tx: LockedPinTransaction) => Promise<T>,
  ): Promise<T>;
}

export class MemoryPinStore implements PinStore {
  private readonly records = new Map<string, PinRecord>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly clock: () => number;

  constructor(options: { clock?: () => number } = {}) {
    this.clock = options.clock ?? Date.now;
  }

  async get(userId: string): Promise<PinRecord | null> {
    const record = this.records.get(userId);
    return record ? { ...record } : null;
  }

  async create(record: NewPinRecord): Promise<PinRecord> {
    if (this.records.has(record.userId)) {
      throw new Error(`PIN record already exists for user ${record.userId}`);
    }
    const now = this.clock();
    const created: PinRecord = {
      ...record,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.userId, created);
    return { ...created };
  }

  async update(userId: string, updates: PinRecordUpdate): Promise<PinRecord> {
    const existing = this.records.get(userId);
    if (!existing) {
      throw new Error(`PIN record not found for user ${userId}`);
    }
    const updated: PinRecord = {
      ...existing,
      ...updates,
      updatedAt: this.clock(),
    };
    this.records.set(userId, updated);
    return { ...updated };
  }

  async delete(userId: string): Promise<void> {
    this.records.delete(userId);
  }

  async withLock<T>(
    userId: string,
    work: (record: PinRecord | null, tx: LockedPinTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(userId) ?? Promise.resolve();
    const run = previous.then(async () => {
      const snapshot = this.records.get(userId);
      try {
        return await work(snapshot ? { ...snapshot } : null, {
          create: (record) => this.create(record),
          update: (updates) => this.update(userId, updates),
        });
      } catch (error) {
        if (snapshot) this.records.set(userId, snapshot);
        else this.records.delete(userId);
        throw error;
      }
    });
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(userId, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(userId) === tail) this.locks.delete(userId);
    }
  }
}

function rowToRecord(row: UserApprovalPinRow): PinRecord {
  return {
    userId: row.user_id,
    salt: row.salt,
    pinHash: row.pin_hash,
    failedAttempts: row.failed_attempts,
    totalFailed24h: row.total_failed_24h,
    firstFailedAt: row.first_failed_at ? row.first_failed_at.getTime() : null,
    lockedUntil: row.locked_until ? row.locked_until.getTime() : null,
    coolingOffUntil: row.cooling_off_until ? row.cooling_off_until.getTime() : null,
    status: row.status,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

function newRecordInput(record: NewPinRecord): CreateApprovalPinInput {
  return {
    userId: record.userId,
    salt: record.salt,
    pinHash: record.pinHash,
    failedAttempts: record.failedAttempts,
    totalFailed24h: record.totalFailed24h,
    firstFailedAt: record.firstFailedAt === null ? null : new Date(record.firstFailedAt),
    lockedUntil: record.lockedUntil === null ? null : new Date(record.lockedUntil),
    coolingOffUntil: record.coolingOffUntil === null ? null : new Date(record.coolingOffUntil),
    status: record.status,
  };
}

function optionalDate(value: number | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

function updateInput(updates: PinRecordUpdate): UpdateApprovalPinInput {
  return {
    salt: updates.salt,
    pinHash: updates.pinHash,
    failedAttempts: updates.failedAttempts,
    totalFailed24h: updates.totalFailed24h,
    firstFailedAt: optionalDate(updates.firstFailedAt),
    lockedUntil: optionalDate(updates.lockedUntil),
    coolingOffUntil: optionalDate(updates.coolingOffUntil),
    status: updates.status,
  };
}

async function updateRecord(
  sql: SqlClient,
  userId: string,
  updates: PinRecordUpdate,
): Promise<PinRecord> {
  const row = await updateApprovalPin(sql, userId, updateInput(updates));
  if (!row) throw new Error(`PIN record not found for user ${userId}`);
  return rowToRecord(row);
}

export class PostgresPinStore implements PinStore {
  constructor(private readonly sql: Sql) {}

  async get(userId: string): Promise<PinRecord | null> {
    const row = await getApprovalPin(this.sql, userId);
    return row ? rowToRecord(row) : null;
  }

  async create(record: NewPinRecord): Promise<PinRecord> {
    return rowToRecord(await createApprovalPin(this.sql, newRecordInput(record)));
  }

  async update(userId: string, updates: PinRecordUpdate): Promise<PinRecord> {
    return updateRecord(this.sql, userId, updates);
  }

  async delete(userId: string): Promise<void> {
    await deleteApprovalPin(this.sql, userId);
  }

  async withLock<T>(
    userId: string,
    work: (record: PinRecord | null, tx: LockedPinTransaction) => Promise<T>,
  ): Promise<T> {
    return withLockedApprovalPin(this.sql, userId, (tx, row) =>
      work(row ? rowToRecord(row) : null, {
        create: async (record) => rowToRecord(await createApprovalPin(tx, newRecordInput(record))),
        update: (updates) => updateRecord(tx, userId, updates),
      }),
    );
  }
}

export interface ActionTokenStore {
  createToken(userId: string, actionHash: string, ttlMs?: number): Promise<string>;
  consumeToken(userId: string, actionHash: string, token: string): Promise<boolean>;
}

interface StoredActionToken {
  readonly userId: string;
  readonly actionHash: string;
  readonly expiresAt: number;
  used: boolean;
}

export class MemoryActionTokenStore implements ActionTokenStore {
  private readonly tokens = new Map<string, StoredActionToken>();
  private readonly clock: () => number;

  constructor(options: { clock?: () => number } = {}) {
    this.clock = options.clock ?? Date.now;
  }

  async createToken(userId: string, actionHash: string, ttlMs = 60_000): Promise<string> {
    const token = crypto.randomUUID();
    const now = this.clock();
    this.tokens.set(token, {
      userId,
      actionHash,
      expiresAt: now + ttlMs,
      used: false,
    });
    return token;
  }

  async consumeToken(userId: string, actionHash: string, token: string): Promise<boolean> {
    const entry = this.tokens.get(token);
    if (!entry) return false;
    const now = this.clock();
    if (now > entry.expiresAt) {
      this.tokens.delete(token);
      return false;
    }
    if (entry.userId !== userId || entry.actionHash !== actionHash) {
      return false;
    }
    if (entry.used) {
      return false;
    }
    entry.used = true;
    this.tokens.delete(token); // Burn once consumed
    return true;
  }
}
