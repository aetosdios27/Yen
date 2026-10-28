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

export function validatePinSecret(secret: unknown): string {
  if (typeof secret !== "string" || secret.trim().length < 32) {
    throw new Error(
      "PIN_HMAC_SECRET must be an explicit, cryptographically strong secret of at least 32 characters",
    );
  }
  return secret;
}

export interface InFlightTracker {
  readonly count: number;
  inc(): void;
  dec(): void;
}

export class DefaultInFlightTracker implements InFlightTracker {
  private inFlight = 0;
  get count() {
    return this.inFlight;
  }
  inc() {
    this.inFlight++;
  }
  dec() {
    this.inFlight = Math.max(0, this.inFlight - 1);
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
  readonly pinStore: PinStore;
  readonly actionTokenStore: ActionTokenStore;
  readonly pinNotificationService: PinNotificationService;
  readonly pinSecret: string | null;
  readonly otpVerifier?: PinOtpVerifier | null;
  readonly pinService: PinService;
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
  readonly concurrencyLimit: number;
  readonly requestTimeoutMs: number;
  readonly inFlightTracker: InFlightTracker;
  readonly isShuttingDown: () => boolean;
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
    concurrencyLimit: 100,
    requestTimeoutMs: 15000,
    inFlightTracker: new DefaultInFlightTracker(),
    isShuttingDown: () => false,
  };
}
