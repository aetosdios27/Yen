import crypto from "node:crypto";
import type { Sql } from "@yen/db";
import {
  createApprovalPin,
  deleteApprovalPin,
  getApprovalPin,
  type UserApprovalPinRow,
  updateApprovalPin,
  userApprovalPinRowSchema,
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

export interface PinStore {
  get(userId: string): Promise<PinRecord | null>;
  create(record: Omit<PinRecord, "createdAt" | "updatedAt">): Promise<PinRecord>;
  update(
    userId: string,
    updates: Partial<Omit<PinRecord, "userId" | "createdAt">>,
  ): Promise<PinRecord>;
  withLockedRecord<T>(
    userId: string,
    operation: (
      record: PinRecord,
      update: (updates: Partial<Omit<PinRecord, "userId" | "createdAt">>) => Promise<PinRecord>,
    ) => Promise<T>,
  ): Promise<T>;
  delete(userId: string): Promise<void>;
}

export class MemoryPinStore implements PinStore {
  private readonly records = new Map<string, PinRecord>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly clock: () => number;

  constructor(options: { clock?: () => number } = {}) {
    this.clock = options.clock ?? Date.now;
  }

  async get(userId: string): Promise<PinRecord | null> {
    const record = this.records.get(userId);
    return record ? { ...record } : null;
  }

  async create(record: Omit<PinRecord, "createdAt" | "updatedAt">): Promise<PinRecord> {
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

  async update(
    userId: string,
    updates: Partial<Omit<PinRecord, "userId" | "createdAt">>,
  ): Promise<PinRecord> {
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

  async withLockedRecord<T>(
    userId: string,
    operation: (
      record: PinRecord,
      update: (updates: Partial<Omit<PinRecord, "userId" | "createdAt">>) => Promise<PinRecord>,
    ) => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(userId);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(userId, current);
    await previous;
    try {
      const record = await this.get(userId);
      if (!record) throw new Error(`PIN record not found for user ${userId}`);
      return await operation(record, (updates) => this.update(userId, updates));
    } finally {
      release();
      if (this.locks.get(userId) === current) this.locks.delete(userId);
    }
  }

  async delete(userId: string): Promise<void> {
    this.records.delete(userId);
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

export class PostgresPinStore implements PinStore {
  constructor(private readonly sql: Sql) {}

  async get(userId: string): Promise<PinRecord | null> {
    const row = await getApprovalPin(this.sql, userId);
    return row ? rowToRecord(row) : null;
  }

  async create(record: Omit<PinRecord, "createdAt" | "updatedAt">): Promise<PinRecord> {
    const row = await createApprovalPin(this.sql, {
      userId: record.userId,
      salt: record.salt,
      pinHash: record.pinHash,
      failedAttempts: record.failedAttempts,
      totalFailed24h: record.totalFailed24h,
      firstFailedAt: record.firstFailedAt ? new Date(record.firstFailedAt) : null,
      lockedUntil: record.lockedUntil ? new Date(record.lockedUntil) : null,
      coolingOffUntil: record.coolingOffUntil ? new Date(record.coolingOffUntil) : null,
      status: record.status,
    });
    return rowToRecord(row);
  }

  async update(
    userId: string,
    updates: Partial<Omit<PinRecord, "userId" | "createdAt">>,
  ): Promise<PinRecord> {
    const row = await updateApprovalPin(this.sql, userId, {
      salt: updates.salt,
      pinHash: updates.pinHash,
      failedAttempts: updates.failedAttempts,
      totalFailed24h: updates.totalFailed24h,
      firstFailedAt:
        updates.firstFailedAt !== undefined
          ? updates.firstFailedAt === null
            ? null
            : new Date(updates.firstFailedAt)
          : undefined,
      lockedUntil:
        updates.lockedUntil !== undefined
          ? updates.lockedUntil === null
            ? null
            : new Date(updates.lockedUntil)
          : undefined,
      coolingOffUntil:
        updates.coolingOffUntil !== undefined
          ? updates.coolingOffUntil === null
            ? null
            : new Date(updates.coolingOffUntil)
          : undefined,
      status: updates.status,
    });
    if (!row) throw new Error(`PIN record not found for user ${userId}`);
    return rowToRecord(row);
  }

  async withLockedRecord<T>(
    userId: string,
    operation: (
      record: PinRecord,
      update: (updates: Partial<Omit<PinRecord, "userId" | "createdAt">>) => Promise<PinRecord>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`SELECT * FROM user_approval_pins WHERE user_id = ${userId} FOR UPDATE`;
      if (rows.length === 0) throw new Error(`PIN record not found for user ${userId}`);
      let current = rowToRecord(userApprovalPinRowSchema.parse(rows[0]));
      return await operation(current, async (updates) => {
        const next = { ...current, ...updates };
        const updatedRows = await tx`
          UPDATE user_approval_pins SET
            salt = ${next.salt}, pin_hash = ${next.pinHash},
            failed_attempts = ${next.failedAttempts}, total_failed_24h = ${next.totalFailed24h},
            first_failed_at = ${next.firstFailedAt === null ? null : new Date(next.firstFailedAt)},
            locked_until = ${next.lockedUntil === null ? null : new Date(next.lockedUntil)},
            cooling_off_until = ${next.coolingOffUntil === null ? null : new Date(next.coolingOffUntil)},
            status = ${next.status}, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ${userId} RETURNING *
        `;
        if (updatedRows.length === 0) throw new Error(`PIN record not found for user ${userId}`);
        current = rowToRecord(userApprovalPinRowSchema.parse(updatedRows[0]));
        return current;
      });
    }) as unknown as Promise<T>;
  }

  async delete(userId: string): Promise<void> {
    await deleteApprovalPin(this.sql, userId);
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
