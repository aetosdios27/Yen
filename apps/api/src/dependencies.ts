import type { AppendEventInput, StoredFundEvent, WaitlistEntry } from "@yen/db";
import type { Context } from "hono";
import { rateLimitEnv, rateLimits } from "./config.js";
import { jsonLogger, type Logger } from "./logging.js";
import { denyAllPolicy, type Policy } from "./policy.js";
import { MemoryStorageAdapter, type StorageAdapter } from "./storage.js";
import {
  type EvidenceStore,
  type IdempotencyStore,
  MemoryEvidenceStore,
  MemoryIdempotencyStore,
  MemoryRateLimitStore,
  type RateLimit,
  type RateLimitStore,
} from "./stores.js";
import { UnconfiguredVirusScannerAdapter, type VirusScannerAdapter } from "./virus-scanner.js";

export interface Principal {
  readonly id: string;
}

export type ApiEnv = {
  Variables: {
    requestId: string;
    principal: Principal | null;
  };
};

export interface WaitlistStore {
  add(entry: WaitlistEntry): Promise<"created" | "duplicate">;
}

export class MemoryWaitlistStore implements WaitlistStore {
  private readonly entries = new Map<string, WaitlistEntry>();
  async add(entry: WaitlistEntry) {
    if (this.entries.has(entry.contact)) return "duplicate" as const;
    this.entries.set(entry.contact, entry);
    return "created" as const;
  }
}

export interface AppDependencies {
  readonly waitlistStore: WaitlistStore;
  readonly waitlistLimit: RateLimit;
  readonly waitlistBodyLimit: number;
  readonly evidenceStore: EvidenceStore;
  readonly storageAdapter: StorageAdapter;
  readonly virusScanner: VirusScannerAdapter;
  readonly eventAppender?: ((input: AppendEventInput) => Promise<StoredFundEvent>) | undefined;
  readonly clock: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly waitlistMinResponseMs: number;
  readonly idGenerator: () => string;
  readonly idempotencyStore: IdempotencyStore;
  readonly rateLimitStore: RateLimitStore;
  readonly logger: Logger;
  readonly policy: Policy;
  readonly principal: Principal | null;
  readonly clientIp: (context: Context<ApiEnv>) => string;
  readonly corsOrigins: string[];
  readonly readiness: () => Promise<boolean>;
  readonly rateLimits: { readonly ip: RateLimit; readonly principal: RateLimit };
}

export function defaultDependencies(clock: () => number = Date.now): AppDependencies {
  return {
    waitlistStore: new MemoryWaitlistStore(),
    waitlistLimit: { capacity: 5, refillMs: 3600000 },
    waitlistBodyLimit: 8192,
    evidenceStore: new MemoryEvidenceStore(),
    storageAdapter: new MemoryStorageAdapter(),
    virusScanner: new UnconfiguredVirusScannerAdapter(),
    clock,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    waitlistMinResponseMs: 75,
    idGenerator: () => crypto.randomUUID(),
    idempotencyStore: new MemoryIdempotencyStore({ clock }),
    rateLimitStore: new MemoryRateLimitStore(),
    logger: jsonLogger,
    policy: denyAllPolicy,
    principal: null,
    clientIp: () => "unknown",
    corsOrigins: [],
    readiness: async () => true,
    rateLimits: rateLimits(rateLimitEnv.parse({})),
  };
}
