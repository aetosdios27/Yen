import type { AppendEventInput, StoredFundEvent, WaitlistEntry } from "@yen/db";
import { type PseudonymId, parsePseudonymId } from "@yen/eventlog";
import { type ApprovalProofVerifier, type ExpenseStore, InMemoryExpenseStore } from "@yen/ledger";
import type { FundRole } from "@yen/policy";
import type { Context } from "hono";
import {
  type AuthStore,
  DevStubOtpDeliveryProvider,
  MemoryAuthStore,
  type OtpDeliveryProvider,
  type Session,
  TRUSTED_DEVICE_IDLE_TIMEOUT_MS,
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
import type { FundRecord } from "./policy.js";
import { denyAllPolicy, type Policy } from "./policy.js";
import {
  MemoryReconciliationStore,
  type ReconciliationStore,
} from "./reconciliation/memory-store.js";
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
  readonly assurance?: "otp_verified" | "owner_vouched" | undefined;
  readonly role?: FundRole | undefined;
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

export interface DonationPledgeRequest {
  readonly fundId: string;
  readonly amountPaise: number;
  readonly utr: string;
  readonly donorName?: string;
  readonly donorContact?: string;
  readonly donorNameChoice?: "full" | "initials" | "anonymous";
  readonly actorPseudonym?: PseudonymId;
  readonly actorUserId?: string;
}

export type DonationPledgeOutcome =
  | { readonly kind: "pledged"; readonly donationId: string }
  | { readonly kind: "duplicate_utr" };

export interface DonationPledgeStore {
  pledge(request: DonationPledgeRequest): Promise<DonationPledgeOutcome>;
}

export interface DisplayNameStore {
  get(fundId: string, pseudonymId: string): Promise<string | null>;
  officeholderNamesShown(fundId: string): Promise<boolean>;
}

export class MemoryDisplayNameStore implements DisplayNameStore {
  private readonly names = new Map<string, string>();
  private readonly officeholderSettings = new Set<string>();

  async get(fundId: string, pseudonymId: string) {
    return this.names.get(`${fundId}:${pseudonymId}`) ?? null;
  }

  async officeholderNamesShown(fundId: string) {
    return this.officeholderSettings.has(fundId);
  }

  set(fundId: string, pseudonymId: string, name: string) {
    this.names.set(`${fundId}:${pseudonymId}`, name);
  }

  setOfficeholderNamesShown(fundId: string, shown: boolean) {
    if (shown) this.officeholderSettings.add(fundId);
    else this.officeholderSettings.delete(fundId);
  }
}

/** Dev and test store. One reference can only be claimed once, like the real table. */
export class MemoryDonationPledgeStore implements DonationPledgeStore {
  private readonly claimed = new Set<string>();

  async pledge(request: DonationPledgeRequest): Promise<DonationPledgeOutcome> {
    if (this.claimed.has(request.utr)) return { kind: "duplicate_utr" };
    this.claimed.add(request.utr);
    return { kind: "pledged", donationId: crypto.randomUUID() };
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

export interface FundStore {
  get(fundId: string): FundRecord | undefined;
  set(fundId: string, fund: FundRecord): void;
}

/** Process-local test/development fund store. Fund persistence is tracked separately. */
export class MemoryFundStore implements FundStore {
  private readonly funds = new Map<string, FundRecord>();

  get(fundId: string) {
    return this.funds.get(fundId);
  }

  set(fundId: string, fund: FundRecord) {
    this.funds.set(fundId, fund);
  }
}

export interface AppDependencies {
  readonly waitlistStore: WaitlistStore;
  readonly expenseStore: ExpenseStore;
  readonly actorForUser: (userId: string, fundId: string) => Promise<PseudonymId>;
  readonly fundStore?: FundStore | undefined;
  readonly approvalProofVerifier: ApprovalProofVerifier;
  readonly donationPledgeStore: DonationPledgeStore;
  readonly reconciliationStore: ReconciliationStore;
  readonly displayNameStore: DisplayNameStore;
  readonly pledgeLimit: RateLimit;
  readonly pledgeBodyLimit: number;
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
  readonly trustedDeviceIdleTimeoutMs: number;
  readonly concurrencyLimit: number;
  readonly requestTimeoutMs: number;
  readonly inFlightTracker: InFlightTracker;
  readonly isShuttingDown: () => boolean;
}

export function defaultDependencies(
  clock: () => number = Date.now,
  expenseStore?: ExpenseStore,
): AppDependencies {
  if (!expenseStore && process.env.NODE_ENV === "production") {
    throw new Error("Production API requires a PostgreSQL expense store");
  }
  const resolvedExpenseStore = expenseStore ?? new InMemoryExpenseStore();
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
  const actors = new Map<string, PseudonymId>();

  return {
    waitlistStore: new MemoryWaitlistStore(),
    expenseStore: resolvedExpenseStore,
    actorForUser: async (userId, fundId) => {
      const key = `${fundId}:${userId}`;
      let actor = actors.get(key);
      if (!actor) {
        actor = parsePseudonymId(`psn_${globalThis.crypto.randomUUID()}`);
        actors.set(key, actor);
      }
      return actor;
    },
    approvalProofVerifier: (signature) => signature.credentialId === "pin-proof",
    donationPledgeStore: new MemoryDonationPledgeStore(),
    reconciliationStore: new MemoryReconciliationStore(),
    displayNameStore: new MemoryDisplayNameStore(),
    pledgeLimit: { capacity: 10, refillMs: 3600000 },
    pledgeBodyLimit: 4096,
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
    trustedDeviceIdleTimeoutMs: TRUSTED_DEVICE_IDLE_TIMEOUT_MS,
    concurrencyLimit: 100,
    requestTimeoutMs: 15000,
    inFlightTracker: new DefaultInFlightTracker(),
    isShuttingDown: () => false,
  };
}
