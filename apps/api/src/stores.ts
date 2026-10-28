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

export interface IdempotencyOptions {
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
  index: number;
  readonly key: string;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxEntries: number;
  private readonly heap: Bucket[] = [];

  constructor(options: { readonly maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 100_000;
  }

  get entryCount(): number {
    return this.buckets.size;
  }

  async consume(key: string, limit: RateLimit, now: number) {
    while (this.heap[0] && this.heap[0].fullAt <= now) this.remove(this.heap[0]);
    const previous = this.buckets.get(key);
    if (!previous && this.buckets.size >= this.maxEntries) {
      const oldest = this.heap[0]?.fullAt ?? Infinity;
      return {
        allowed: false,
        overloaded: true,
        retryAfterSeconds: Math.min(86400, Math.max(1, Math.ceil((oldest - now) / 1000))),
      } as const;
    }
    // A delayed caller can pass an earlier `now`; the bucket clock must never move backwards.
    const effectiveNow = previous ? Math.max(now, previous.updatedAt) : now;
    const tokens = previous
      ? limit.expiresAt !== undefined
        ? previous.tokens
        : Math.min(
            limit.capacity,
            previous.tokens +
              (Math.max(0, effectiveNow - previous.updatedAt) * limit.capacity) / limit.refillMs,
          )
      : limit.capacity;
    if (previous) this.remove(previous);
    const remaining = tokens >= 1 ? tokens - 1 : tokens;
    const bucket: Bucket = {
      key,
      index: this.heap.length,
      tokens: remaining,
      updatedAt: effectiveNow,
      fullAt:
        limit.expiresAt ??
        effectiveNow + ((limit.capacity - remaining) * limit.refillMs) / limit.capacity,
    };
    this.buckets.set(key, bucket);
    this.heap.push(bucket);
    this.up(bucket.index);
    if (tokens >= 1) return { allowed: true } as const;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(((1 - tokens) * limit.refillMs) / limit.capacity / 1000),
      ),
    } as const;
  }

  private swap(a: number, b: number): void {
    const first = this.heap[a];
    const second = this.heap[b];
    if (!first || !second) return;
    this.heap[a] = second;
    this.heap[b] = first;
    first.index = b;
    second.index = a;
  }

  private up(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const childBucket = this.heap[index];
      const parentBucket = this.heap[parent];
      if (!childBucket || !parentBucket || parentBucket.fullAt <= childBucket.fullAt) return;
      this.swap(index, parent);
      index = parent;
    }
  }

  private remove(bucket: Bucket): void {
    const index = bucket.index;
    const last = this.heap.pop();
    this.buckets.delete(bucket.key);
    if (!last || last === bucket) return;
    this.heap[index] = last;
    last.index = index;
    this.up(index);
    for (let current = last.index; ; ) {
      const left = current * 2 + 1;
      const right = left + 1;
      let smallest = current;
      const currentBucket = this.heap[smallest];
      const leftBucket = this.heap[left];
      if (currentBucket && leftBucket && leftBucket.fullAt < currentBucket.fullAt) smallest = left;
      const smallestBucket = this.heap[smallest];
      const rightBucket = this.heap[right];
      if (smallestBucket && rightBucket && rightBucket.fullAt < smallestBucket.fullAt)
        smallest = right;
      if (smallest === current) break;
      this.swap(current, smallest);
      current = smallest;
    }
  }
}

export {
  type PostgresIdempotencyOptions,
  PostgresIdempotencyStore,
  type PostgresRateLimitOptions,
  PostgresRateLimitStore,
} from "./postgres-stores.js";
export type AllowedEvidenceMimeType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export interface StoredEvidence {
  readonly evidenceId: string;
  readonly fundId: string;
  readonly expenseId: string;
  readonly fileSha256: string;
  readonly mimeType: AllowedEvidenceMimeType;
  readonly fileSizeBytes: number;
  readonly fileName: string;
  readonly objectKey?: string | undefined;
  readonly duplicateDetected: boolean;
  readonly isDuplicate: boolean;
  readonly duplicateExpenseId?: string | undefined;
  readonly vendorName?: string | undefined;
  readonly gstin?: string | undefined;
  readonly invoiceNumber?: string | undefined;
  readonly invoiceDate?: string | undefined;
  readonly createdAt: string;
}

export interface EvidenceStore {
  save(evidence: StoredEvidence): Promise<StoredEvidence>;
  getByExpense(fundId: string, expenseId: string): Promise<readonly StoredEvidence[]>;
  findBySha256(fundId: string, sha256: string): Promise<readonly StoredEvidence[]>;
}

export class MemoryEvidenceStore implements EvidenceStore {
  private readonly records = new Map<string, StoredEvidence>();
  private readonly byHash = new Map<string, StoredEvidence[]>();

  async save(evidence: StoredEvidence): Promise<StoredEvidence> {
    this.records.set(evidence.evidenceId, evidence);
    const list = this.byHash.get(evidence.fileSha256) ?? [];
    list.push(evidence);
    this.byHash.set(evidence.fileSha256, list);
    return evidence;
  }

  async getByExpense(fundId: string, expenseId: string): Promise<readonly StoredEvidence[]> {
    return Array.from(this.records.values()).filter(
      (e) => e.fundId === fundId && e.expenseId === expenseId,
    );
  }

  async findBySha256(fundId: string, sha256: string): Promise<readonly StoredEvidence[]> {
    return (this.byHash.get(sha256) ?? []).filter((evidence) => evidence.fundId === fundId);
  }
}
