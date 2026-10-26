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
  | { readonly kind: "new" }
  | { readonly kind: "in_progress"; readonly requestHash: string }
  | { readonly kind: "complete"; readonly requestHash: string; readonly response: StoredResponse };

export interface IdempotencyStore {
  begin(request: IdempotencyRequest): Promise<IdempotencyBegin>;
  complete(request: IdempotencyRequest, response: StoredResponse): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Exclude<IdempotencyBegin, { kind: "new" }>>();

  async begin(request: IdempotencyRequest): Promise<IdempotencyBegin> {
    const existing = this.entries.get(request.key);
    if (existing) return existing;
    this.entries.set(request.key, { kind: "in_progress", requestHash: request.requestHash });
    return { kind: "new" };
  }

  async complete(request: IdempotencyRequest, response: StoredResponse): Promise<void> {
    const existing = this.entries.get(request.key);
    if (existing?.kind !== "in_progress" || existing.requestHash !== request.requestHash) {
      throw new Error("Idempotency reservation missing or changed");
    }
    this.entries.set(request.key, {
      kind: "complete",
      requestHash: request.requestHash,
      response,
    });
  }
}

export interface RateLimit {
  readonly capacity: number;
  readonly refillMs: number;
}

export interface RateLimitStore {
  consume(
    key: string,
    limit: RateLimit,
    now: number,
  ): Promise<
    { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number }
  >;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  async consume(key: string, limit: RateLimit, now: number) {
    const previous = this.buckets.get(key);
    const tokens = previous
      ? Math.min(
          limit.capacity,
          previous.tokens +
            (Math.max(0, now - previous.updatedAt) * limit.capacity) / limit.refillMs,
        )
      : limit.capacity;
    this.buckets.set(key, { tokens: tokens >= 1 ? tokens - 1 : tokens, updatedAt: now });
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
