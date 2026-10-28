import type { WaitlistEntry } from "@yen/db";
import type { Context } from "hono";
import {
  type AuthStore,
  DevStubOtpDeliveryProvider,
  MemoryAuthStore,
  type OtpDeliveryProvider,
  type Session,
} from "./auth/index.js";
import { rateLimitEnv, rateLimits } from "./config.js";
import { jsonLogger, type Logger } from "./logging.js";
import { denyAllPolicy, type Policy } from "./policy.js";
import {
  type IdempotencyStore,
  MemoryIdempotencyStore,
  MemoryRateLimitStore,
  type RateLimit,
  type RateLimitStore,
} from "./stores.js";

export interface Principal {
  readonly id: string;
}

export type ApiEnv = {
  Variables: {
    requestId: string;
    principal: Principal | null;
    session: Session | null;
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
  readonly authStore: AuthStore;
  readonly otpDeliveryProvider: OtpDeliveryProvider;
  readonly otpCooldownMs: number;
  readonly otpExpiryMs: number;
  readonly otpMaxAttempts: number;
  readonly otpHashKey: string;
  readonly otpRateLimitIp: RateLimit;
  readonly otpRateLimitPhone: RateLimit;
  readonly sessionCookieName: string;
  readonly sessionMaxAgeSeconds: number;
}

export function defaultDependencies(clock: () => number = Date.now): AppDependencies {
  return {
    waitlistStore: new MemoryWaitlistStore(),
    waitlistLimit: { capacity: 5, refillMs: 3600000 },
    waitlistBodyLimit: 8192,
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
    authStore: new MemoryAuthStore(),
    otpDeliveryProvider: new DevStubOtpDeliveryProvider(clock),
    otpCooldownMs: 60_000,
    otpExpiryMs: 300_000,
    otpMaxAttempts: 3,
    otpHashKey: "development-only-otp-hash-key-change-me",
    otpRateLimitIp: { capacity: 10, refillMs: 600_000 },
    otpRateLimitPhone: { capacity: 5, refillMs: 600_000 },
    sessionCookieName: "yen_session",
    sessionMaxAgeSeconds: 30 * 24 * 3600,
  };
}
