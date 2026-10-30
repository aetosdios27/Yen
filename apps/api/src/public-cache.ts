import crypto from "node:crypto";

/** Shared caches keep public fund reads for a minute and may serve them for five more. */
export const PUBLIC_READ_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
export const PRIVATE_READ_CACHE_CONTROL = "private, no-store";
export const STALE_WARNING = '110 - "Response is stale"';

const KEY_SEPARATOR = "\u0000";

export type CachedEntry = {
  readonly body: unknown;
  readonly etag: string;
  readonly storedAt: number;
};

export type CacheHit<T> = {
  readonly body: T;
  readonly etag: string;
  readonly storedAt: number;
  readonly stale: boolean;
};

export type PublicReadCacheOptions = {
  readonly clock: () => number;
  readonly freshMs?: number;
  readonly staleMs?: number;
  readonly maxEntries?: number;
};

/**
 * Per-instance cache for anonymous fund reads.
 *
 * Entries are tagged by fund id so an event on one fund drops only that fund,
 * concurrent misses share a single origin read, and a failing origin can fall
 * back to the last good copy inside the stale window.
 */
export class PublicReadCache {
  readonly #entries = new Map<string, CachedEntry>();
  readonly #inFlight = new Map<string, Promise<CachedEntry>>();
  readonly #clock: () => number;
  readonly #freshMs: number;
  readonly #staleMs: number;
  readonly #maxEntries: number;

  constructor(options: PublicReadCacheOptions) {
    this.#clock = options.clock;
    this.#freshMs = options.freshMs ?? 60_000;
    this.#staleMs = options.staleMs ?? 300_000;
    this.#maxEntries = options.maxEntries ?? 256;
  }

  #key(fundId: string, kind: string): string {
    return `${fundId}${KEY_SEPARATOR}${kind}`;
  }

  read(fundId: string, kind: string): CachedEntry | undefined {
    return this.#entries.get(this.#key(fundId, kind));
  }

  write(fundId: string, kind: string, body: unknown): CachedEntry {
    const key = this.#key(fundId, kind);
    const entry: CachedEntry = {
      body,
      etag: etagFor(body),
      storedAt: this.#clock(),
    };
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.#evictOverflow();
    return entry;
  }

  /** Drops every cached read for one fund and leaves every other fund intact. */
  invalidateFund(fundId: string): void {
    const prefix = `${fundId}${KEY_SEPARATOR}`;
    for (const key of this.#entries.keys()) {
      if (key.startsWith(prefix)) this.#entries.delete(key);
    }
  }

  /**
   * Returns a fresh entry, or reads the origin once for every concurrent caller.
   * When the origin fails inside the stale window the last good entry is served.
   */
  async load<T>(fundId: string, kind: string, produce: () => Promise<T>): Promise<CacheHit<T>> {
    const key = this.#key(fundId, kind);
    const cached = this.#entries.get(key);
    const now = this.#clock();
    if (cached && now - cached.storedAt < this.#freshMs) {
      return { ...cached, body: cached.body as T, stale: false };
    }

    const running = this.#inFlight.get(key);
    if (running) {
      const shared = await running;
      return { ...shared, body: shared.body as T, stale: false };
    }

    const pending = produce().then((body) => this.write(fundId, kind, body));
    this.#inFlight.set(key, pending);
    try {
      const fresh = await pending;
      return { ...fresh, body: fresh.body as T, stale: false };
    } catch (error) {
      if (cached && now - cached.storedAt < this.#freshMs + this.#staleMs) {
        return { ...cached, body: cached.body as T, stale: true };
      }
      throw error;
    } finally {
      this.#inFlight.delete(key);
    }
  }

  #evictOverflow(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) return;
      this.#entries.delete(oldest.value);
    }
  }
}

export function etagFor(body: unknown): string {
  return `"${crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
}

/** Reads a lone strong `If-None-Match` value; lists are not used by our clients. */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.trim() === etag || header.trim() === "*";
}
