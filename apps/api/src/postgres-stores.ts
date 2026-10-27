import type { Sql } from "@yen/db";
import type {
  IdempotencyBegin,
  IdempotencyRequest,
  IdempotencyStore,
  RateLimit,
  RateLimitStore,
  StoredResponse,
} from "./stores.js";

export interface PostgresIdempotencyOptions {
  readonly clock?: () => number;
  readonly inProgressTtlMs?: number;
  readonly replayRetentionMs?: number;
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  private readonly clock: () => number;
  private readonly inProgressTtlMs: number;
  private readonly replayRetentionMs: number;

  constructor(
    private readonly sql: Sql,
    options: PostgresIdempotencyOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.inProgressTtlMs = options.inProgressTtlMs ?? 30_000;
    this.replayRetentionMs = options.replayRetentionMs ?? 86_400_000;
  }

  /**
   * Reserves an absent key or takes over an expired lease atomically using PostgreSQL UPSERT.
   * PostgreSQL INSERT ... ON CONFLICT DO UPDATE documentation:
   * https://www.postgresql.org/docs/current/sql-insert.html
   * "ON CONFLICT DO UPDATE guarantees an atomic INSERT or UPDATE outcome; provided there is no
   *  independent error, one of those two outcomes is guaranteed, even under high concurrency."
   * PostgreSQL date/time functions: https://www.postgresql.org/docs/current/functions-datetime.html
   */
  async begin(request: IdempotencyRequest): Promise<IdempotencyBegin> {
    const now = this.clock();
    const token = crypto.randomUUID();
    const leaseExpiresAtMs = now + this.inProgressTtlMs;

    const rows = await this.sql<
      {
        token: string;
        request_hash: string;
        response: StoredResponse | null;
        lease_expires_at: Date | null;
        replay_expires_at: Date | null;
      }[]
    >`
      INSERT INTO idempotency_keys (
        key,
        request_hash,
        token,
        lease_expires_at,
        response,
        replay_expires_at,
        created_at
      )
      VALUES (
        ${request.key},
        ${request.requestHash},
        ${token},
        to_timestamp(${leaseExpiresAtMs} / 1000.0),
        NULL,
        NULL,
        to_timestamp(${request.createdAt} / 1000.0)
      )
      ON CONFLICT (key) DO UPDATE
      SET
        token = CASE
          WHEN (idempotency_keys.response IS NULL AND idempotency_keys.lease_expires_at <= to_timestamp(${now} / 1000.0))
            OR (idempotency_keys.response IS NOT NULL AND idempotency_keys.replay_expires_at <= to_timestamp(${now} / 1000.0))
          THEN EXCLUDED.token
          ELSE idempotency_keys.token
        END,
        request_hash = CASE
          WHEN (idempotency_keys.response IS NULL AND idempotency_keys.lease_expires_at <= to_timestamp(${now} / 1000.0))
            OR (idempotency_keys.response IS NOT NULL AND idempotency_keys.replay_expires_at <= to_timestamp(${now} / 1000.0))
          THEN EXCLUDED.request_hash
          ELSE idempotency_keys.request_hash
        END,
        lease_expires_at = CASE
          WHEN (idempotency_keys.response IS NULL AND idempotency_keys.lease_expires_at <= to_timestamp(${now} / 1000.0))
            OR (idempotency_keys.response IS NOT NULL AND idempotency_keys.replay_expires_at <= to_timestamp(${now} / 1000.0))
          THEN EXCLUDED.lease_expires_at
          ELSE idempotency_keys.lease_expires_at
        END,
        response = CASE
          WHEN (idempotency_keys.response IS NULL AND idempotency_keys.lease_expires_at <= to_timestamp(${now} / 1000.0))
            OR (idempotency_keys.response IS NOT NULL AND idempotency_keys.replay_expires_at <= to_timestamp(${now} / 1000.0))
          THEN NULL
          ELSE idempotency_keys.response
        END,
        replay_expires_at = CASE
          WHEN (idempotency_keys.response IS NULL AND idempotency_keys.lease_expires_at <= to_timestamp(${now} / 1000.0))
            OR (idempotency_keys.response IS NOT NULL AND idempotency_keys.replay_expires_at <= to_timestamp(${now} / 1000.0))
          THEN NULL
          ELSE idempotency_keys.replay_expires_at
        END,
        created_at = CASE
          WHEN (idempotency_keys.response IS NULL AND idempotency_keys.lease_expires_at <= to_timestamp(${now} / 1000.0))
            OR (idempotency_keys.response IS NOT NULL AND idempotency_keys.replay_expires_at <= to_timestamp(${now} / 1000.0))
          THEN EXCLUDED.created_at
          ELSE idempotency_keys.created_at
        END
      RETURNING
        token,
        request_hash,
        response,
        lease_expires_at,
        replay_expires_at
    `;

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to reserve idempotency key");
    }

    const rawResponse = row.response;
    const response: StoredResponse | null =
      rawResponse === null
        ? null
        : typeof rawResponse === "string"
          ? (JSON.parse(rawResponse) as StoredResponse)
          : (rawResponse as StoredResponse);

    if (row.token === token) {
      return { kind: "new", token };
    }

    if (response !== null) {
      return {
        kind: "complete",
        requestHash: row.request_hash,
        response,
      };
    }

    return {
      kind: "in_progress",
      requestHash: row.request_hash,
    };
  }

  /**
   * Persists the response for a reserved key if the fencing token and lease have not expired.
   * PostgreSQL UPDATE documentation: https://www.postgresql.org/docs/current/sql-update.html
   */
  async complete(
    request: IdempotencyRequest,
    token: string,
    response: StoredResponse,
  ): Promise<void> {
    const now = this.clock();
    const replayExpiresAtMs = now + this.replayRetentionMs;

    const updated = await this.sql`
      UPDATE idempotency_keys
      SET
        response = ${JSON.stringify(response)}::jsonb,
        replay_expires_at = to_timestamp(${replayExpiresAtMs} / 1000.0),
        lease_expires_at = NULL
      WHERE key = ${request.key}
        AND token = ${token}
        AND request_hash = ${request.requestHash}
        AND response IS NULL
        AND lease_expires_at > to_timestamp(${now} / 1000.0)
      RETURNING key
    `;

    if (updated.length === 0) {
      throw new Error("Idempotency reservation missing or changed");
    }
  }

  /**
   * Releases an in-progress reservation if the fencing token matches.
   * A stale worker cannot release a taken-over lease.
   */
  async release(request: IdempotencyRequest, token: string): Promise<void> {
    await this.sql`
      DELETE FROM idempotency_keys
      WHERE key = ${request.key}
        AND token = ${token}
        AND request_hash = ${request.requestHash}
        AND response IS NULL
    `;
  }

  /**
   * Sweeps expired completed responses and expired abandoned leases.
   * PostgreSQL SKIP LOCKED documentation: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE
   * "With SKIP LOCKED, any selected rows that cannot be immediately locked are skipped. ...
   *  This is useful for building queue-like and concurrent cleanup mechanisms without lock contention."
   */
  async sweep(now: number = this.clock(), limit = 1000): Promise<number> {
    const deleted = await this.sql`
      DELETE FROM idempotency_keys
      WHERE ctid IN (
        SELECT ctid
        FROM idempotency_keys
        WHERE (response IS NOT NULL AND replay_expires_at <= to_timestamp(${now} / 1000.0))
           OR (response IS NULL AND lease_expires_at <= to_timestamp(${now} / 1000.0))
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING key
    `;
    return deleted.length;
  }
}

export interface PostgresRateLimitOptions {
  readonly maxEntries?: number;
}

export class PostgresRateLimitStore implements RateLimitStore {
  constructor(
    private readonly sql: Sql,
    private readonly options: PostgresRateLimitOptions = {},
  ) {}

  /**
   * Consumes tokens from a shared PostgreSQL token bucket.
   * PostgreSQL advisory lock documentation: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS
   * "pg_advisory_xact_lock obtains an exclusive transaction-level advisory lock.
   *  The lock is automatically released at transaction end."
   * PostgreSQL explicit locking: https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS
   * PostgreSQL INSERT ... ON CONFLICT DO UPDATE: https://www.postgresql.org/docs/current/sql-insert.html
   */
  async consume(
    key: string,
    limit: RateLimit,
    now: number,
  ): Promise<
    | { readonly allowed: true }
    | { readonly allowed: false; readonly retryAfterSeconds: number; readonly overloaded?: true }
  > {
    return await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

      const existingRows = await tx<{ tokens: number; updated_at: Date; expires_at: Date }[]>`
        SELECT tokens, updated_at, expires_at
        FROM rate_limits
        WHERE key = ${key}
      `;
      const existing = existingRows[0];

      if (!existing && this.options.maxEntries !== undefined) {
        const [{ count }] = await tx<[{ count: bigint }]>`
          SELECT count(*)::bigint AS count
          FROM rate_limits
          WHERE expires_at > to_timestamp(${now} / 1000.0)
        `;
        if (Number(count) >= this.options.maxEntries) {
          const oldestRows = await tx<{ expires_at: Date }[]>`
            SELECT expires_at
            FROM rate_limits
            WHERE expires_at > to_timestamp(${now} / 1000.0)
            ORDER BY expires_at ASC
            LIMIT 1
          `;
          const oldest = oldestRows[0]?.expires_at.getTime() ?? Infinity;
          return {
            allowed: false,
            overloaded: true,
            retryAfterSeconds: Math.min(86400, Math.max(1, Math.ceil((oldest - now) / 1000))),
          };
        }
      }

      const isExpired = existing ? existing.expires_at.getTime() <= now : false;
      const previousTokens = existing && !isExpired ? existing.tokens : limit.capacity;

      const tokens =
        existing && !isExpired
          ? limit.expiresAt !== undefined
            ? previousTokens
            : Math.min(
                limit.capacity,
                previousTokens +
                  (Math.max(0, now - existing.updated_at.getTime()) * limit.capacity) /
                    limit.refillMs,
              )
          : limit.capacity;

      const remaining = tokens >= 1 ? tokens - 1 : tokens;
      const fullAt =
        limit.expiresAt ?? now + ((limit.capacity - remaining) * limit.refillMs) / limit.capacity;

      await tx`
        INSERT INTO rate_limits (key, tokens, updated_at, expires_at)
        VALUES (
          ${key},
          ${remaining},
          to_timestamp(${now} / 1000.0),
          to_timestamp(${fullAt} / 1000.0)
        )
        ON CONFLICT (key) DO UPDATE
        SET
          tokens = EXCLUDED.tokens,
          updated_at = EXCLUDED.updated_at,
          expires_at = EXCLUDED.expires_at
      `;

      if (tokens >= 1) return { allowed: true } as const;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(((1 - tokens) * limit.refillMs) / limit.capacity / 1000),
        ),
      } as const;
    });
  }

  /**
   * Prunes full or expired rate-limit buckets.
   * PostgreSQL SKIP LOCKED documentation: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE
   */
  async prune(now: number = Date.now(), limit = 1000): Promise<number> {
    const deleted = await this.sql`
      DELETE FROM rate_limits
      WHERE ctid IN (
        SELECT ctid
        FROM rate_limits
        WHERE expires_at <= to_timestamp(${now} / 1000.0)
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING key
    `;
    return deleted.length;
  }
}
