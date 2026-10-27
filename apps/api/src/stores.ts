export interface StoredResponse {
  readonly status: number;
  readonly headers: [string, string][];
  readonly bodyBase64: string | null;
}

export interface IdempotencyRequest {
  readonly key: string;
  readonly requestHash: string;
  readonly createdAt: number;
}

export type IdempotencyBegin =
  | { readonly kind: "new"; readonly token: string }
  | { readonly kind: "in_progress"; readonly requestHash: string }
  | { readonly kind: "complete"; readonly requestHash: string; readonly response: StoredResponse };

export interface IdempotencyStore {
  /** A row needs key, request_hash, token, lease_expires_at, response, replay_expires_at, and created_at; token fences stale writers after takeover. */
  begin(request: IdempotencyRequest): Promise<IdempotencyBegin>;
  complete(request: IdempotencyRequest, token: string, response: StoredResponse): Promise<void>;
  release(request: IdempotencyRequest, token: string): Promise<void>;
}

type Reservation = {
  readonly kind: "in_progress";
  readonly requestHash: string;
  readonly token: string;
  readonly expiresAt: number;
};
type Completion = {
  readonly kind: "complete";
  readonly requestHash: string;
  readonly response: StoredResponse;
  readonly expiresAt: number;
};

interface IdempotencyOptions {
  readonly clock?: () => number;
  readonly inProgressTtlMs?: number;
  readonly replayRetentionMs?: number;
  readonly maxEntries?: number;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Reservation | Completion>();
  private readonly clock: () => number;
  private readonly inProgressTtlMs: number;
  private readonly replayRetentionMs: number;
  private readonly maxEntries: number;

  constructor(options: IdempotencyOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.inProgressTtlMs = options.inProgressTtlMs ?? 30_000;
    this.replayRetentionMs = options.replayRetentionMs ?? 86_400_000;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  async begin(request: IdempotencyRequest): Promise<IdempotencyBegin> {
    const now = this.clock();
    this.sweep(now);
    const existing = this.entries.get(request.key);
    if (existing) {
      if (existing.kind === "complete") {
        return { kind: "complete", requestHash: existing.requestHash, response: existing.response };
      }
      return { kind: "in_progress", requestHash: existing.requestHash };
    }
    while (this.entries.size >= this.maxEntries) {
      let evicted = false;
      for (const [key, entry] of this.entries) {
        if (entry.kind !== "complete") continue;
        this.entries.delete(key);
        evicted = true;
        break;
      }
      if (!evicted) throw new Error("Idempotency store capacity exhausted");
    }
    const token = crypto.randomUUID();
    this.entries.set(request.key, {
      kind: "in_progress",
      requestHash: request.requestHash,
      token,
      expiresAt: now + this.inProgressTtlMs,
    });
    return { kind: "new", token };
  }

  async complete(
    request: IdempotencyRequest,
    token: string,
    response: StoredResponse,
  ): Promise<void> {
    const existing = this.entries.get(request.key);
    if (
      existing?.kind !== "in_progress" ||
      existing.token !== token ||
      existing.requestHash !== request.requestHash ||
      existing.expiresAt <= this.clock()
    ) {
      throw new Error("Idempotency reservation missing or changed");
    }
    this.entries.set(request.key, {
      kind: "complete",
      requestHash: request.requestHash,
      response,
      expiresAt: this.clock() + this.replayRetentionMs,
    });
  }

  async release(request: IdempotencyRequest, token: string): Promise<void> {
    const existing = this.entries.get(request.key);
    if (
      existing?.kind === "in_progress" &&
      existing.token === token &&
      existing.requestHash === request.requestHash
    ) {
      this.entries.delete(request.key);
    }
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

export interface RateLimit {
  readonly capacity: number;
  readonly refillMs: number;
  readonly expiresAt?: number;
}

export interface RateLimitStore {
  consume(
    key: string,
    limit: RateLimit,
    now: number,
  ): Promise<
    | { readonly allowed: true }
    | { readonly allowed: false; readonly retryAfterSeconds: number; readonly overloaded?: true }
  >;
}

interface Bucket {
  readonly tokens: number;
  readonly updatedAt: number;
  readonly fullAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxEntries: number;

  constructor(options: { readonly maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 100_000;
  }

  get entryCount(): number {
    return this.buckets.size;
  }

  async consume(key: string, limit: RateLimit, now: number) {
    for (const [bucketKey, bucket] of this.buckets) {
      if (bucket.fullAt <= now) this.buckets.delete(bucketKey);
    }
    const previous = this.buckets.get(key);
    if (!previous && this.buckets.size >= this.maxEntries) {
      let oldest = Infinity;
      for (const bucket of this.buckets.values()) oldest = Math.min(oldest, bucket.fullAt);
      return {
        allowed: false,
        overloaded: true,
        retryAfterSeconds: Math.min(86400, Math.max(1, Math.ceil((oldest - now) / 1000))),
      } as const;
    }
    const tokens = previous
      ? limit.expiresAt !== undefined
        ? previous.tokens
        : Math.min(
            limit.capacity,
            previous.tokens +
              (Math.max(0, now - previous.updatedAt) * limit.capacity) / limit.refillMs,
          )
      : limit.capacity;
    this.buckets.delete(key);
    const remaining = tokens >= 1 ? tokens - 1 : tokens;
    this.buckets.set(key, {
      tokens: remaining,
      updatedAt: now,
      fullAt:
        limit.expiresAt ?? now + ((limit.capacity - remaining) * limit.refillMs) / limit.capacity,
    });
    if (tokens >= 1) return { allowed: true } as const;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(((1 - tokens) * limit.refillMs) / limit.capacity / 1000),
      ),
    } as const;
  }
}
