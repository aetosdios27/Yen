import { randomBytes } from "node:crypto";
import type { AppendEventInput, StoredFundEvent, WaitlistEntry } from "@yen/db";
import { uuidv7 } from "@yen/db";
import { type PseudonymId, parsePseudonymId } from "@yen/eventlog";
import { type ApprovalProofVerifier, type ExpenseStore, InMemoryExpenseStore } from "@yen/ledger";
import { type FundSubscriptionStore, MemoryFundSubscriptionStore } from "@yen/notifications";
import type { FundRole } from "@yen/policy";
import { failClosedPayeeVerifier, type PayeeVerifier } from "@yen/policy";
import type { DeliveryProvider } from "@yen/shared";
import { paise } from "@yen/shared";
import type { Context } from "hono";
import { type AlertStore, MemoryAlertStore } from "./alert-store.js";
import {
  type AuthStore,
  createOtpDeliveryProvider,
  MemoryAuthStore,
  type Session,
  TRUSTED_DEVICE_IDLE_TIMEOUT_MS,
} from "./auth/index.js";
import { rateLimitEnv, rateLimits } from "./config.js";
import { type DeviceSignatureConfig, DeviceSignatureService } from "./device-signature/service.js";
import { type DeviceSignatureStore, MemoryDeviceSignatureStore } from "./device-signature/store.js";
import { PostgresEvidenceStore } from "./evidence-store-postgres.js";
import type { PostgresExpenseObjectionStore } from "./expense-objections.js";
import { jsonLogger, type Logger } from "./logging.js";
import { MemoryPayeeProfileStore, type PayeeProfileStore } from "./payee-rules/profile-store.js";
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
import { DEFAULT_OBJECTION_WINDOW_HOURS, denyAllPolicy, type Policy } from "./policy.js";
import { MemoryPrivacyStore, type PrivacyStore } from "./privacy-store.js";
import { MemoryReceiptStore, type ReceiptStore } from "./receipt-store.js";
import {
  MemoryReconciliationStore,
  type ReconciliationStore,
} from "./reconciliation/memory-store.js";
import {
  MemoryStorageAdapter,
  type StorageAdapter,
  UnconfiguredStorageAdapter,
} from "./storage.js";
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

export interface PublicFundDonation {
  readonly id: string;
  readonly occurredAt: string;
  readonly amountPaise: bigint;
  readonly donorDisplayName: string | null;
  readonly donorNameChoice: "full" | "initials" | "anonymous";
}

export interface PublicFundReadStore {
  /** Confirmed credits only. Pledges are deliberately excluded until bank matched. */
  donations(fundId: string): Promise<readonly PublicFundDonation[]>;
}

export class MemoryPublicFundReadStore implements PublicFundReadStore {
  private readonly values = new Map<string, PublicFundDonation[]>();

  async donations(fundId: string) {
    return this.values.get(fundId) ?? [];
  }

  set(fundId: string, donations: readonly PublicFundDonation[]) {
    this.values.set(fundId, [...donations]);
  }
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

  constructor(private readonly receiptStore?: ReceiptStore) {}

  async pledge(request: DonationPledgeRequest): Promise<DonationPledgeOutcome> {
    if (this.claimed.has(request.utr)) return { kind: "duplicate_utr" };
    this.claimed.add(request.utr);
    const donationId = crypto.randomUUID();
    if (this.receiptStore?.addReceipt) {
      await this.receiptStore.addReceipt({
        donationId,
        fundId: request.fundId,
        fundTitle: "Community Fund",
        amountPaise: request.amountPaise,
        utr: request.utr,
        donorDisplayName: request.donorName,
        donorNameChoice: request.donorNameChoice,
        status: "pledged",
        createdAt: new Date().toISOString(),
        proofUrl: `/verify?donationId=${encodeURIComponent(donationId)}`,
      });
    }
    return { kind: "pledged", donationId };
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
  readonly persistent?: boolean;
  get(fundId: string): Promise<FundRecord | undefined> | FundRecord | undefined;
  set(fundId: string, fund: FundRecord): void;
  create?(fundId: string, fund: FundRecord, ownerUserId: string): Promise<void>;
  changeVisibility?(input: {
    fundId: string;
    ownerUserId: string;
    visibility: FundRecord["fund"]["visibility"];
    expectedVersion: number;
    occurredAt: string;
  }): Promise<FundRecord | null>;
  rolesFor?(fundId: string, userId: string): Promise<string[]>;
  addMember?(input: {
    fundId: string;
    actorUserId: string;
    userId: string;
    role: "approver" | "treasurer" | "member";
    occurredAt: string;
  }): Promise<void>;
  removeMember?(input: {
    fundId: string;
    actorUserId: string;
    userId: string;
    occurredAt: string;
  }): Promise<void>;
  changePayee?(input: {
    fundId: string;
    actorUserId: string;
    vpa: string;
    occurredAt: string;
  }): Promise<void>;
  changePolicy?(input: {
    fundId: string;
    actorUserId: string;
    policy: Record<string, unknown>;
    occurredAt: string;
  }): Promise<void>;
  getPolicy?(fundId: string): Promise<import("@yen/ledger").FundPolicy | undefined>;
}

/** Process-local test/development fund store. Fund persistence is tracked separately. */
export class MemoryFundStore implements FundStore {
  readonly persistent = false;
  private readonly funds = new Map<string, FundRecord>();
  private readonly versions = new Map<string, number>();
  private readonly policies = new Map<string, import("@yen/ledger").FundPolicy>();
  private readonly members = new Map<string, Map<string, Set<string>>>();

  get(fundId: string) {
    return this.funds.get(fundId);
  }

  set(fundId: string, fund: FundRecord) {
    this.funds.set(fundId, fund);
    this.versions.set(fundId, fund.fund.version ?? this.versions.get(fundId) ?? 1);
    if (!this.members.has(fundId))
      this.members.set(fundId, new Map([[fund.owner, new Set(["owner"])]]));
  }

  async changeVisibility(input: {
    fundId: string;
    ownerUserId: string;
    visibility: FundRecord["fund"]["visibility"];
    expectedVersion: number;
    occurredAt: string;
  }) {
    const current = this.funds.get(input.fundId);
    if (
      !current ||
      current.owner !== input.ownerUserId ||
      this.versions.get(input.fundId) !== input.expectedVersion
    )
      return null;
    if (current.fund.visibility === input.visibility) return current;
    const updated = {
      ...current,
      fund: { ...current.fund, visibility: input.visibility, version: input.expectedVersion + 1 },
    };
    this.funds.set(input.fundId, updated);
    this.versions.set(input.fundId, input.expectedVersion + 1);
    return updated;
  }

  async addMember(input: {
    fundId: string;
    actorUserId: string;
    userId: string;
    role: "approver" | "treasurer" | "member";
    occurredAt: string;
  }) {
    const members = this.members.get(input.fundId);
    if (!members) return;
    const roles = members.get(input.userId) ?? new Set<string>();
    roles.add(input.role);
    members.set(input.userId, roles);
    this.bumpVersion(input.fundId);
  }

  async removeMember(input: {
    fundId: string;
    actorUserId: string;
    userId: string;
    occurredAt: string;
  }) {
    this.members.get(input.fundId)?.delete(input.userId);
    this.bumpVersion(input.fundId);
  }

  async changePayee(input: {
    fundId: string;
    actorUserId: string;
    vpa: string;
    occurredAt: string;
  }) {
    const current = this.funds.get(input.fundId);
    this.bumpVersion(input.fundId);
    if (current)
      this.funds.set(input.fundId, {
        ...current,
        fund: { ...current.fund, upiVpa: input.vpa, version: this.versions.get(input.fundId) },
      });
  }

  async changePolicy(input: {
    fundId: string;
    actorUserId: string;
    policy: Record<string, unknown>;
    occurredAt: string;
  }) {
    const approvalQuorum = Number(input.policy.approvalQuorum ?? input.policy.approval_quorum ?? 2);
    const objectionWindowHours = Number(
      input.policy.objectionWindowHours ??
        input.policy.objection_window_hours ??
        DEFAULT_OBJECTION_WINDOW_HOURS,
    );
    const threshold = input.policy.requireDeviceSignatureAbove ?? null;
    this.policies.set(input.fundId, {
      approvalQuorum,
      objectionWindowHours,
      autoExpireHours: 72,
      requireDeviceSignatureAbove: threshold === null ? null : paise(Number(threshold)),
    });
    this.bumpVersion(input.fundId);
  }

  async getPolicy(fundId: string) {
    return this.policies.get(fundId);
  }

  private bumpVersion(fundId: string) {
    const version = (this.versions.get(fundId) ?? 1) + 1;
    this.versions.set(fundId, version);
    const current = this.funds.get(fundId);
    if (current) this.funds.set(fundId, { ...current, fund: { ...current.fund, version } });
  }
}

export interface AppDependencies {
  readonly waitlistStore: WaitlistStore;
  readonly expenseStore: ExpenseStore;
  readonly payeeProfileStore: PayeeProfileStore;
  readonly payeeFingerprintSalt: string;
  readonly payeeVerifier: PayeeVerifier;
  readonly objectionStore?: PostgresExpenseObjectionStore | undefined;
  readonly actorForUser: (userId: string, fundId: string) => Promise<PseudonymId>;
  readonly fundStore?: FundStore | undefined;
  readonly alertStore?: AlertStore | undefined;
  readonly approvalProofVerifier: ApprovalProofVerifier;
  readonly donationPledgeStore: DonationPledgeStore;
  readonly publicFundReadStore: PublicFundReadStore;
  readonly reconciliationStore: ReconciliationStore;
  readonly receiptStore: ReceiptStore;
  readonly fundSubscriptionStore: FundSubscriptionStore;
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
  readonly privacyStore: PrivacyStore;
  readonly otpDeliveryProvider: DeliveryProvider;
  readonly otpCooldownMs: number;
  readonly otpExpiryMs: number;
  readonly otpMaxAttempts: number;
  readonly otpHashKey: string;
  readonly partnerWebhookSecret: string | null;
  readonly otpRateLimitIp: RateLimit;
  readonly otpRateLimitPhone: RateLimit;
  readonly sessionCookieName: string;
  readonly sessionMaxAgeSeconds: number;
  readonly trustedDeviceIdleTimeoutMs: number;
  readonly deviceSignatureStore: DeviceSignatureStore;
  readonly deviceSignatureConfig: DeviceSignatureConfig;
  readonly deviceSignatureService: DeviceSignatureService;
  readonly concurrencyLimit: number;
  readonly requestTimeoutMs: number;
  readonly inFlightTracker: InFlightTracker;
  readonly isShuttingDown: () => boolean;
}

export function defaultDependencies(
  clock: () => number = Date.now,
  expenseStore?: ExpenseStore,
  evidenceStore?: EvidenceStore,
  storageAdapter?: StorageAdapter,
): AppDependencies {
  if (!expenseStore && process.env.NODE_ENV === "production") {
    throw new Error("Production API requires a PostgreSQL expense store");
  }
  if (process.env.NODE_ENV === "production" && !evidenceStore) {
    throw new Error("Production API requires a PostgreSQL evidence store");
  }
  if (process.env.NODE_ENV === "production" && !(evidenceStore instanceof PostgresEvidenceStore)) {
    throw new Error("Production API requires a PostgreSQL evidence store");
  }
  if (
    process.env.NODE_ENV === "production" &&
    (!storageAdapter ||
      storageAdapter instanceof MemoryStorageAdapter ||
      storageAdapter instanceof UnconfiguredStorageAdapter)
  ) {
    throw new Error("Production API requires configured durable evidence storage");
  }
  const resolvedExpenseStore = expenseStore ?? new InMemoryExpenseStore();
  const resolvedEvidenceStore = evidenceStore ?? new MemoryEvidenceStore();
  const resolvedStorageAdapter = storageAdapter ?? new MemoryStorageAdapter();
  const payeeFingerprintSalt = process.env.PAYEE_FINGERPRINT_SALT;
  if (payeeFingerprintSalt !== undefined && payeeFingerprintSalt.length < 32) {
    throw new Error("PAYEE_FINGERPRINT_SALT must contain at least 32 characters");
  }
  if (process.env.NODE_ENV === "production" && !payeeFingerprintSalt) {
    throw new Error("Production API requires PAYEE_FINGERPRINT_SALT");
  }
  const pinStore = new MemoryPinStore({ clock });
  const actionTokenStore = new MemoryActionTokenStore({ clock });
  const pinNotificationService = new MemoryPinNotificationService();
  const deviceSignatureStore = new MemoryDeviceSignatureStore();
  const deviceSignatureConfig = {
    rpId: process.env.WEBAUTHN_RP_ID ?? "localhost",
    origin: process.env.WEBAUTHN_ORIGIN ?? "http://localhost:3000",
    rpName: process.env.WEBAUTHN_RP_NAME ?? "Yen",
  } satisfies DeviceSignatureConfig;
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.WEBAUTHN_RP_ID || !process.env.WEBAUTHN_ORIGIN)
  ) {
    throw new Error("WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN are required in production");
  }
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

  const receiptStore = new MemoryReceiptStore();
  const fundSubscriptionStore = new MemoryFundSubscriptionStore();

  return {
    waitlistStore: new MemoryWaitlistStore(),
    expenseStore: resolvedExpenseStore,
    payeeProfileStore: new MemoryPayeeProfileStore(),
    payeeFingerprintSalt: payeeFingerprintSalt ?? randomBytes(32).toString("hex"),
    payeeVerifier: failClosedPayeeVerifier,
    actorForUser: async (userId, fundId) => {
      const key = `${fundId}:${userId}`;
      let actor = actors.get(key);
      if (!actor) {
        actor = parsePseudonymId(`psn_${globalThis.crypto.randomUUID()}`);
        actors.set(key, actor);
      }
      return actor;
    },
    alertStore: new MemoryAlertStore(),
    approvalProofVerifier: (signature) => signature.credentialId === "pin-proof",
    donationPledgeStore: new MemoryDonationPledgeStore(receiptStore),
    publicFundReadStore: new MemoryPublicFundReadStore(),
    reconciliationStore: new MemoryReconciliationStore(),
    receiptStore,
    fundSubscriptionStore,
    displayNameStore: new MemoryDisplayNameStore(),
    pledgeLimit: { capacity: 10, refillMs: 3600000 },
    pledgeBodyLimit: 4096,
    waitlistLimit: { capacity: 5, refillMs: 3600000 },
    waitlistBodyLimit: 8192,
    evidenceStore: resolvedEvidenceStore,
    storageAdapter: resolvedStorageAdapter,
    virusScanner: new UnconfiguredVirusScannerAdapter(),
    clock,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    waitlistMinResponseMs: 75,
    idGenerator: uuidv7,
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
    privacyStore: new MemoryPrivacyStore(),
    otpDeliveryProvider: createOtpDeliveryProvider(
      process.env.NODE_ENV === "production"
        ? "production"
        : process.env.NODE_ENV === "test"
          ? "test"
          : "development",
      clock,
    ),
    otpCooldownMs: 60_000,
    otpExpiryMs: 300_000,
    otpMaxAttempts: 3,
    otpHashKey: "development-only-otp-hash-key-change-me",
    partnerWebhookSecret: null,
    otpRateLimitIp: { capacity: 10, refillMs: 600_000 },
    otpRateLimitPhone: { capacity: 5, refillMs: 600_000 },
    sessionCookieName: "yen_session",
    sessionMaxAgeSeconds: 30 * 24 * 3600,
    trustedDeviceIdleTimeoutMs: TRUSTED_DEVICE_IDLE_TIMEOUT_MS,
    deviceSignatureStore,
    deviceSignatureConfig,
    deviceSignatureService: new DeviceSignatureService({
      store: deviceSignatureStore,
      config: deviceSignatureConfig,
      clock,
    }),
    concurrencyLimit: 100,
    requestTimeoutMs: 15000,
    inFlightTracker: new DefaultInFlightTracker(),
    isShuttingDown: () => false,
  };
}
