import type { WaitlistEntry } from "@yen/db";
import type { Context } from "hono";
import { rateLimitEnv, rateLimits } from "./config.js";
import { jsonLogger, type Logger } from "./logging.js";
import {
  type ActionTokenStore,
  MemoryActionTokenStore,
  MemoryPinNotificationService,
  MemoryPinStore,
  type PinNotificationService,
  type PinOtpVerifier,
  PinService,
  type PinStore,
} from "./pin/index.js";
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
  readonly roles?: readonly string[];
  readonly capabilities?: readonly string[];
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

export function validatePinSecret(secret: unknown): string {
  if (typeof secret !== "string" || secret.trim().length < 32) {
    throw new Error(
      "PIN_HMAC_SECRET must be an explicit, cryptographically strong secret of at least 32 characters",
    );
  }
  return secret;
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
  readonly pinStore: PinStore;
  readonly actionTokenStore: ActionTokenStore;
  readonly pinNotificationService: PinNotificationService;
  readonly pinSecret: string | null;
  readonly otpVerifier?: PinOtpVerifier | null;
  readonly pinService: PinService;
}

export function defaultDependencies(clock: () => number = Date.now): AppDependencies {
  const pinStore = new MemoryPinStore({ clock });
  const actionTokenStore = new MemoryActionTokenStore({ clock });
  const pinNotificationService = new MemoryPinNotificationService();
  const rawPinSecret = process.env.PIN_HMAC_SECRET;
  const pinSecret = rawPinSecret ? validatePinSecret(rawPinSecret) : null;
  const pinService = new PinService({
    pinStore,
    actionTokenStore,
    notificationService: pinNotificationService,
    pinSecret,
    otpVerifier: null,
    clock,
  });

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
    pinStore,
    actionTokenStore,
    pinNotificationService,
    pinSecret,
    otpVerifier: null,
    pinService,
  };
}
