import crypto from "node:crypto";
import { OpenAPIHono, type z } from "@hono/zod-openapi";
import { normalizeWaitlistContact } from "@yen/db";
import { payloadSchemas } from "@yen/eventlog";
import {
  BankTransactionMismatchError,
  createDraftRequest,
  DuplicateApprovalError,
  type ExpenseRequest,
  type FundPolicy,
  InvalidPasskeySignatureError,
  InvalidStateTransitionError,
  payExpense,
  reconcileExpense,
  rejectExpense,
  SeparationOfDutiesError,
  type SignedApproval,
  submitExpense,
} from "@yen/ledger";
import {
  DEFAULT_FUND_POLICY,
  isValidRole,
  can as policyCan,
  redactExpenseDetails,
  redactExpenseProofs,
  redactFundReadModel,
} from "@yen/policy";
import { paise, parseFundId, parseGstin } from "@yen/shared";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import {
  AuthPinOtpVerifier,
  generateOtpCode,
  generateSalt,
  generateSessionToken,
  hashOtp,
  hashSessionToken,
  normalizePhone,
  parseDeviceInfo,
  verifyOtp,
} from "./auth/index.js";
import { registerOwnerInviteRoutes } from "./auth/invite-routes.js";
import { buildInfo } from "./build-info.js";
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  addMemberRoute,
  approveExpenseRoute,
  changePayeeRoute,
  changePinRoute,
  changePolicyRoute,
  confirmPinResetRoute,
  createExpenseRoute,
  createFundRoute,
  donationDetailsRoute,
  type expenseSchema,
  getEvidenceRoute,
  getExpenseRoute,
  getFundRoute,
  getPinStatusRoute,
  getSessionsRoute,
  healthRoute,
  listExpensesRoute,
  lockTrustedDeviceRoute,
  logoutAllRoute,
  logoutRoute,
  MAX_EVIDENCE_FILE_SIZE_BYTES,
  manualMatchRoute,
  meRoute,
  openapiRoute,
  openapiSchema,
  partnerWebhookRoute,
  payExpenseRoute,
  pledgeDonationRoute,
  principalSchema,
  publicFundBreakdownRoute,
  publicFundSummaryRoute,
  publicFundTimelineRoute,
  readyRoute,
  reconcileExpenseRoute,
  rejectExpenseRoute,
  removeMemberRoute,
  requestPinResetRoute,
  revokeSessionRoute,
  rotateSessionRoute,
  sendOtpRoute,
  setupPinRoute,
  statementUploadRoute,
  submitExpenseRoute,
  unlockPinRoute,
  unlockTrustedDeviceRoute,
  unmatchedCreditsRoute,
  uploadEvidenceRoute,
  verifyOtpRoute,
  verifyPinRoute,
  versionRoute,
  waitlistRoute,
} from "./contract.js";
import {
  type ApiEnv,
  type AppDependencies,
  defaultDependencies,
  MemoryFundStore,
  type Principal,
} from "./dependencies.js";
import { ApiError, errorBody, errorStatus, ReadinessError, StoreError } from "./errors.js";
import { stripExifMetadata } from "./exif-strip.js";
import { getVerifiedEvidenceObject } from "./integrity-job.js";
import { logMethod } from "./logging.js";
import {
  concurrencyLimit,
  idempotency,
  isEvidenceRoute,
  isPendingDeviceAuthRoute,
  isPledgeRoute,
  isPublicAuthRoute,
  isPublicDonationRoute,
  isPublicFundReadRoute,
  isWaitlistRoute,
  rateLimit,
  requestContext,
  requestTimeout,
  requireAuth,
} from "./middleware.js";
import { verifyMimeSignature } from "./mime-signature.js";
import { computeActionHash, PinService } from "./pin/index.js";
import type {
  ExistingExpenseResource,
  ExpenseAction,
  ExpenseResource,
  ExpenseView,
  FundAction,
  FundResource,
} from "./policy.js";
import { redactActionReceipt as redactReceipt } from "./policy.js";
import { publicExpenseDetailRoute, publicExpenseProofsRoute } from "./public-expense-contract.js";
import { parseBankStatementCsv } from "./reconciliation/csv-parser.js";
import { normalizePartnerWebhook } from "./reconciliation/partner-schema.js";
import { buildOpaqueEvidenceKey, sanitizeEvidenceFilename } from "./storage.js";
import type { AllowedEvidenceMimeType, StoredEvidence } from "./stores.js";
import type { VirusScanResult } from "./virus-scanner.js";

export { devPolicy } from "./policy.js";

export function createApp(overrides: Partial<AppDependencies> = {}) {
  const baseDeps = {
    ...defaultDependencies(overrides.clock, overrides.expenseStore),
    ...overrides,
  };
  const otpVerifier =
    overrides.otpVerifier === undefined
      ? new AuthPinOtpVerifier({
          authStore: baseDeps.authStore,
          deliveryProvider: baseDeps.otpDeliveryProvider,
          rateLimitStore: baseDeps.rateLimitStore,
          phoneRateLimit: baseDeps.otpRateLimitPhone,
          otpHashKey: baseDeps.otpHashKey,
          clock: baseDeps.clock,
          idGenerator: baseDeps.idGenerator,
          cooldownMs: baseDeps.otpCooldownMs,
          expiryMs: baseDeps.otpExpiryMs,
          maxAttempts: baseDeps.otpMaxAttempts,
        })
      : overrides.otpVerifier;
  const pinService =
    overrides.pinService ??
    new PinService({
      pinStore: baseDeps.pinStore,
      actionTokenStore: baseDeps.actionTokenStore,
      notificationService: baseDeps.pinNotificationService,
      pinSecret: baseDeps.pinSecret,
      otpVerifier,
      clock: baseDeps.clock,
    });
  const deps = { ...baseDeps, pinService };
  const actorFor = (principal: Principal, fundId: string) =>
    deps.actorForUser(principal.id, fundId);
  const app = new OpenAPIHono<ApiEnv>({
    strict: false,
    defaultHook: (result) => {
      if (!result.success) {
        throw new ApiError(
          "validation_failed",
          result.error.issues.map((issue) => ({
            path: [
              result.target,
              ...issue.path.map((part) => (typeof part === "number" ? part : String(part))),
            ],
            message: issue.message,
          })),
        );
      }
    },
  });
  app.use("*", requestContext(deps));
  // CORS wraps the timeout and load-shedding middleware so that their 503 and 504 responses
  // carry the same headers as any other response and browsers can read Retry-After.
  if (deps.corsOrigins.length > 0) {
    app.use(
      "*",
      cors({
        origin: deps.corsOrigins,
        allowMethods: ["GET", "HEAD", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Idempotency-Key", "X-Request-Id"],
        exposeHeaders: ["X-Request-Id", "Retry-After", "Idempotent-Replayed"],
      }),
    );
  }
  app.use("*", requestTimeout(deps));
  app.use("*", concurrencyLimit(deps));
  app.onError((error, c) => {
    const errorKind =
      error instanceof ApiError && error.code === "overloaded"
        ? "rate_limit_store_full"
        : error instanceof ApiError && error.code === "gateway_timeout"
          ? "timeout"
          : error instanceof ReadinessError
            ? "readiness"
            : error instanceof StoreError
              ? "store"
              : error instanceof ApiError && error.code === "validation_failed"
                ? "validation"
                : error instanceof HTTPException
                  ? error.status === 400
                    ? "validation"
                    : "unknown"
                  : error instanceof Error
                    ? "handler"
                    : "unknown";
    deps.logger.log({
      event: "http_failure",
      requestId: c.get("requestId"),
      route: routePath(c, -1) || "unmatched",
      method: logMethod(c.req.method),
      errorKind,
      errorName: error instanceof Error ? error.constructor.name : "Unknown",
    });
    const failure =
      error instanceof ApiError
        ? error
        : error instanceof HTTPException && error.status === 400
          ? new ApiError("validation_failed")
          : new ApiError("internal");
    if (error && typeof error === "object" && "retryAfterSeconds" in error) {
      c.header("retry-after", String((error as { retryAfterSeconds: number }).retryAfterSeconds));
    }
    return c.json(
      errorBody(failure, c.get("requestId")),
      error instanceof ReadinessError ? 503 : errorStatus[failure.code],
    );
  });
  app.notFound((c) =>
    c.json(errorBody(new ApiError("not_found"), c.get("requestId")), errorStatus.not_found),
  );
  app.use("/v1/*", rateLimit(deps));
  const waitlistBodyLimit = bodyLimit({
    maxSize: deps.waitlistBodyLimit,
    onError: () => {
      throw new ApiError("payload_too_large");
    },
  });
  const defaultBodyLimit = bodyLimit({
    maxSize: 65536,
    onError: () => {
      throw new ApiError("payload_too_large");
    },
  });
  const pledgeBodyLimit = bodyLimit({
    maxSize: deps.pledgeBodyLimit,
    onError: () => {
      throw new ApiError("payload_too_large");
    },
  });
  const evidenceBodyLimit = bodyLimit({
    maxSize: MAX_EVIDENCE_FILE_SIZE_BYTES + 65536,
    onError: () => {
      throw new ApiError("payload_too_large");
    },
  });
  app.use("/v1/*", (c, next) => {
    if (isWaitlistRoute(c.req.path)) return waitlistBodyLimit(c, next);
    if (isPledgeRoute(c.req.path)) return pledgeBodyLimit(c, next);
    if (isEvidenceRoute(c.req.path) && c.req.method === "POST") return evidenceBodyLimit(c, next);
    return defaultBodyLimit(c, next);
  });
  app.use("/v1/*", idempotency(deps));
  app.use("/v1/me", requireAuth);
  app.use("/v1/funds/*", async (c, next) => {
    if (isPublicFundReadRoute(c.req.path) && c.get("principal")) {
      c.header("cache-control", "private, no-store");
    }
    await next();
  });
  // Anyone may pay into a fund; donors sign in later (YEN-22).
  app.use("/v1/funds/*", (c, next) =>
    isPublicDonationRoute(c.req.path) || isPublicFundReadRoute(c.req.path)
      ? next()
      : requireAuth(c, next),
  );
  app.use("/v1/auth/*", (c, next) =>
    isPublicAuthRoute(c.req.path) || isPendingDeviceAuthRoute(c.req.path)
      ? next()
      : requireAuth(c, next),
  );

  const funds = deps.fundStore ?? new MemoryFundStore();
  const authorizedFund = (c: Context<ApiEnv>, action: FundAction, resource: FundResource) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    let allowed = false;
    try {
      allowed = deps.policy.can(principal, action, resource) === true;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      throw new ApiError(action === "fund:read" ? "not_found" : "forbidden");
    }
    return principal;
  };
  app.openapi(waitlistRoute, async (c) => {
    const input = c.req.valid("json");
    const contact = normalizeWaitlistContact(input.contact);
    if (contact === null) throw new ApiError("validation_failed");
    const isEmail = contact.includes("@");
    await deps.waitlistStore.add({
      name: input.name,
      contactKind: isEmail ? "email" : "phone",
      contact,
      org: input.org,
      locale: input.locale,
      consentText: input.consent.text,
      consentVersion: input.consent.version,
    });
    return c.json({ status: "received" }, 201);
  });
  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));
  app.openapi(versionRoute, (c) => c.json(buildInfo, 200));
  app.openapi(readyRoute, async (c) => {
    if (deps.isShuttingDown()) throw new ReadinessError();
    try {
      if (!(await deps.readiness()) || deps.isShuttingDown()) throw new ReadinessError();
    } catch {
      throw new ReadinessError();
    }
    return c.json({ status: "ok" as const }, 200);
  });
  app.openapi(meRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const user = await deps.authStore.getUserById(principal.id);
    if (user) {
      return c.json(
        principalSchema.parse({
          id: user.id,
          phone: user.phone,
          displayName: user.displayName,
          locale: user.locale,
        }),
        200,
      );
    }
    return c.json(principalSchema.parse({ id: principal.id }), 200);
  });
  app.openapi(sendOtpRoute, async (c) => {
    const input = c.req.valid("json");
    const phone = normalizePhone(input.phone);
    if (phone === null) {
      throw new ApiError("validation_failed", [
        { path: ["body", "phone"], message: "Invalid phone number" },
      ]);
    }
    const ip = deps.clientIp(c);
    const now = deps.clock();

    const existing = await deps.authStore.getLatestActiveOtpChallenge(phone, now);
    if (existing && existing.channel === input.channel && now < existing.resendAvailableAt) {
      const waitSeconds = Math.max(1, Math.ceil((existing.resendAvailableAt - now) / 1000));
      c.header("retry-after", String(waitSeconds));
      throw new ApiError("rate_limited");
    }

    const ipRateKey = JSON.stringify(["otp_send_ip", ip]);
    const ipLimit = await deps.rateLimitStore.consume(ipRateKey, deps.otpRateLimitIp, now);
    if (!ipLimit.allowed) {
      c.header("retry-after", String(ipLimit.retryAfterSeconds));
      throw new ApiError(ipLimit.overloaded ? "overloaded" : "rate_limited");
    }

    const phoneRateKey = JSON.stringify(["otp_send_phone", phone]);
    const phoneLimit = await deps.rateLimitStore.consume(phoneRateKey, deps.otpRateLimitPhone, now);
    if (!phoneLimit.allowed) {
      c.header("retry-after", String(phoneLimit.retryAfterSeconds));
      throw new ApiError(phoneLimit.overloaded ? "overloaded" : "rate_limited");
    }

    const code = generateOtpCode();
    const salt = generateSalt();
    const otpHash = hashOtp(deps.otpHashKey, salt, code);
    const channel = input.channel;
    const expiresAt = now + deps.otpExpiryMs;
    const resendAvailableAt = now + deps.otpCooldownMs;

    const deliveryResult = await deps.otpDeliveryProvider.sendOtp({
      phone,
      code,
      preferredChannel: channel,
    });
    if (!deliveryResult.success) {
      throw new ApiError("internal");
    }
    if (deliveryResult.channel !== channel) throw new ApiError("internal");

    await deps.authStore.createOtpChallenge({
      id: deps.idGenerator(),
      phone,
      otpHash,
      salt,
      channel: deliveryResult.channel,
      expiresAt,
      resendAvailableAt,
      maxAttempts: deps.otpMaxAttempts,
      createdAt: now,
    });

    return c.json(
      {
        status: "sent" as const,
        channel: deliveryResult.channel,
        resendAfterSeconds: Math.ceil(deps.otpCooldownMs / 1000),
        expiresAt: new Date(expiresAt).toISOString(),
      },
      200,
    );
  });
  app.openapi(verifyOtpRoute, async (c) => {
    const input = c.req.valid("json");
    const phone = normalizePhone(input.phone);
    if (phone === null) {
      throw new ApiError("validation_failed", [
        { path: ["body", "phone"], message: "Invalid phone number" },
      ]);
    }
    const now = deps.clock();

    if (
      !(await deps.authStore.consumeOtpAttempt(phone, deps.otpMaxAttempts, now, deps.otpExpiryMs))
    ) {
      throw new ApiError("rate_limited");
    }

    const challenge = await deps.authStore.getLatestActiveOtpChallenge(phone, now);
    if (!challenge) {
      throw invalidOrExpiredCode();
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new ApiError("rate_limited", [
        { path: ["body", "code"], message: "Too many failed attempts. Request a new code." },
      ]);
    }

    const matches = verifyOtp(deps.otpHashKey, challenge.salt, input.code, challenge.otpHash);
    if (!matches) {
      const updated = await deps.authStore.incrementOtpAttempts(challenge.id, now);
      if (!updated) throw new ApiError("rate_limited");
      if (updated && updated.attempts >= updated.maxAttempts) {
        throw new ApiError("rate_limited", [
          { path: ["body", "code"], message: "Too many failed attempts. Request a new code." },
        ]);
      }
      throw invalidOrExpiredCode();
    }

    if (!(await deps.authStore.consumeOtpChallenge(challenge.id, now))) {
      throw invalidOrExpiredCode();
    }
    const user = await deps.authStore.findOrCreateUserByPhone(phone, now);

    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const userAgent = c.req.header("user-agent") ?? "";
    const deviceInfo = parseDeviceInfo(userAgent);
    const ipAddress = deps.clientIp(c);
    const sessionId = deps.idGenerator();
    const expiresAt = now + deps.sessionMaxAgeSeconds * 1000;

    const session = await deps.authStore.createSession({
      id: sessionId,
      userId: user.id,
      tokenHash,
      userAgent,
      deviceInfo,
      ipAddress,
      createdAt: now,
      lastActiveAt: now,
      expiresAt,
    });

    setCookie(c, deps.sessionCookieName, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: deps.sessionMaxAgeSeconds,
    });

    return c.json(
      {
        status: "authenticated" as const,
        session: {
          id: session.id,
          token: sessionToken,
          expiresAt: new Date(session.expiresAt).toISOString(),
          user: {
            id: user.id,
            phone: user.phone,
            displayName: user.displayName,
            locale: user.locale,
          },
        },
      },
      200,
    );
  });
  app.openapi(rotateSessionRoute, async (c) => {
    const currentSession = c.get("session");
    if (!currentSession) throw new ApiError("unauthenticated");
    const now = deps.clock();

    const newSessionToken = generateSessionToken();
    const newTokenHash = hashSessionToken(newSessionToken);
    const rotated = await deps.authStore.rotateSession(currentSession.id, newTokenHash, now);
    if (!rotated) throw new ApiError("unauthenticated");

    setCookie(c, deps.sessionCookieName, newSessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: deps.sessionMaxAgeSeconds,
    });

    return c.json(
      {
        status: "rotated" as const,
        session: {
          id: rotated.id,
          token: newSessionToken,
          expiresAt: new Date(rotated.expiresAt).toISOString(),
        },
      },
      200,
    );
  });
  app.openapi(getSessionsRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const currentSession = c.get("session");
    const now = deps.clock();

    const sessions = await deps.authStore.listUserSessions(principal.id, now);
    const trustedSessions = await Promise.all(
      sessions.map(async (session) => ({
        session,
        trusted: await deps.authStore.getTrustedDevice(session.id, now),
      })),
    );
    return c.json(
      {
        sessions: trustedSessions
          .filter((entry) => entry.trusted?.userId === principal.id)
          .map(({ session: s }) => ({
            id: s.id,
            deviceInfo: s.deviceInfo,
            ip: s.ipAddress,
            createdAt: new Date(s.createdAt).toISOString(),
            lastActiveAt: new Date(s.lastActiveAt).toISOString(),
            isCurrent: currentSession ? s.id === currentSession.id : false,
          })),
      },
      200,
    );
  });
  app.openapi(lockTrustedDeviceRoute, async (c) => {
    const session = c.get("session");
    if (!c.get("principal") || !session) throw new ApiError("unauthenticated");
    await deps.authStore.lockTrustedDevice(session.id, deps.clock());
    return c.json({ status: "locked" as const }, 200);
  });
  app.openapi(logoutRoute, async (c) => {
    const currentSession = c.get("session");
    if (!currentSession) throw new ApiError("unauthenticated");
    await deps.authStore.revokeSession(currentSession.id, deps.clock());
    deleteCookie(c, deps.sessionCookieName, { path: "/" });
    return c.json({ status: "logged_out" as const }, 200);
  });
  app.openapi(logoutAllRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    await deps.authStore.revokeAllUserSessions(principal.id, deps.clock());
    deleteCookie(c, deps.sessionCookieName, { path: "/" });
    return c.json({ status: "logged_out_all" as const }, 200);
  });
  app.openapi(revokeSessionRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const param = c.req.valid("param");
    const currentSession = c.get("session");

    const sessions = await deps.authStore.listUserSessions(principal.id, deps.clock());
    const target = sessions.find((s) => s.id === param.sessionId);
    if (!target) throw new ApiError("not_found");

    await deps.authStore.revokeSession(param.sessionId, deps.clock());
    if (currentSession && currentSession.id === param.sessionId) {
      deleteCookie(c, deps.sessionCookieName, { path: "/" });
    }
    return c.json({ status: "revoked" as const }, 200);
  });
  app.openapi(createFundRoute, (c) => {
    const principal = authorizedFund(c, "fund:create", { kind: "fund" });
    const id = parseFundId(deps.idGenerator());
    if (!id.ok) throw new ApiError("internal");
    const input = c.req.valid("json");
    const fund = {
      ...input,
      visibility: input.visibility ?? "private",
      id: id.value,
      createdAt: new Date(deps.clock()).toISOString(),
    };
    const resource = { kind: "fund", fund: { owner: principal.id, fund } } as const;
    funds.set(id.value, resource.fund);
    return c.json(deps.policy.redact(principal, resource), 201);
  });
  app.openapi(getFundRoute, (c) => {
    const id = parseFundId(c.req.valid("param").fundId);
    if (!id.ok) throw new ApiError("not_found");
    const entry = funds.get(id.value);
    if (!entry) throw new ApiError("not_found");
    const resource = { kind: "fund", fund: entry } as const;
    const principal = authorizedFund(c, "fund:read", resource);
    return c.json(deps.policy.redact(principal, resource), 200);
  });
  const publicFundContext = async (fundId: string, principal: Principal | null) => {
    const startedAt = performance.now();
    const entry = funds.get(fundId);
    const parsedFundId = parseFundId(fundId);
    if (!parsedFundId.ok) throw new ApiError("not_found");
    const visibilityTier = entry?.fund.visibility ?? "private";
    const requestedRole: string | undefined =
      principal?.role ?? principal?.roles?.find(isValidRole);
    const role =
      principal?.id === entry?.owner
        ? "owner"
        : requestedRole && isValidRole(requestedRole)
          ? requestedRole
          : "public";
    const actor = principal ? { id: principal.id, role } : { role: "public" as const };
    const allowed = policyCan(actor, "fund:read", {
      kind: "fund",
      fund: {
        fundId: parsedFundId.value,
        ownerId: entry?.owner ?? "",
        policy: { ...DEFAULT_FUND_POLICY, visibilityTier },
      },
    });
    if (!entry || !allowed) {
      const remainingMs = 50 - (performance.now() - startedAt);
      if (remainingMs > 0) await deps.sleep(remainingMs);
      throw new ApiError("not_found");
    }
    return { entry, actor, publicTier: principal === null && visibilityTier === "public" };
  };
  const publicExpenseContext = async (
    fundId: string,
    expenseId: string,
    principal: Principal | null,
  ) => {
    const fundContext = await publicFundContext(fundId, principal);
    const parsedFundId = parseFundId(fundId);
    if (!parsedFundId.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (
      !expense ||
      expense.fundId !== parsedFundId.value ||
      (expense.status === "draft" &&
        (fundContext.actor.role === "public" || fundContext.actor.role === "donor"))
    ) {
      throw new ApiError("not_found");
    }
    const proofs = await deps.evidenceStore.getByExpense(parsedFundId.value, expenseId);
    return { ...fundContext, expense, proofs };
  };
  const setFundReadCache = (c: Context<ApiEnv>, publicTier: boolean, body: unknown) => {
    if (!publicTier) {
      c.header("cache-control", "private, no-store");
      return;
    }
    const serialized = JSON.stringify(body);
    const etag = `"${crypto.createHash("sha256").update(serialized).digest("hex")}"`;
    c.header("etag", etag);
    c.header("cache-control", "public, s-maxage=30, max-age=0, must-revalidate");
  };
  const publicDataGaps = [
    "Donation records are not queryable; raised amount is unknown.",
    "Expense categories are not stored; spending is grouped as Uncategorized.",
    "The event log and anchoring query are not connected; timeline entries are derived from expense records.",
    "Donation records are not queryable; donation display labels cannot be shown.",
    "Authenticated member assignments are not loaded into sessions; donor and member access requires a role-bearing principal.",
  ];
  const listFundExpenses = async (fundId: string) => deps.expenseStore.list(fundId);
  const safePaiseSum = (values: number[]) => {
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(total) || total < 0) throw new ApiError("internal");
    return total;
  };
  app.openapi(publicFundSummaryRoute, async (c) => {
    const fundId = c.req.valid("param").fundId;
    const { entry, actor, publicTier } = await publicFundContext(fundId, c.get("principal"));
    const expenses = await listFundExpenses(fundId);
    const spentPaise = safePaiseSum(
      expenses
        .filter((expense) => expense.status === "paid" || expense.status === "reconciled")
        .map((expense) => expense.amountPaise),
    );
    const body = redactFundReadModel(actor, {
      kind: "fund_summary",
      fundId,
      name: entry.fund.name,
      purpose: actor.role === "public" ? null : (entry.fund.purpose ?? null),
      raisedPaise: null,
      spentPaise: String(spentPaise),
      verification: "unverified",
      dataGaps: publicDataGaps,
    });
    setFundReadCache(c, publicTier, body);
    return c.json(body, 200);
  });
  app.openapi(publicFundBreakdownRoute, async (c) => {
    const fundId = c.req.valid("param").fundId;
    const { actor, publicTier } = await publicFundContext(fundId, c.get("principal"));
    const expenses = await listFundExpenses(fundId);
    const spentPaise = safePaiseSum(
      expenses
        .filter((expense) => expense.status === "paid" || expense.status === "reconciled")
        .map((expense) => expense.amountPaise),
    );
    const body = redactFundReadModel(actor, {
      kind: "fund_breakdown",
      fundId,
      categories:
        spentPaise === 0 ? [] : [{ category: "Uncategorized", spentPaise: String(spentPaise) }],
      dataGaps: publicDataGaps,
    });
    setFundReadCache(c, publicTier, body);
    return c.json(body, 200);
  });
  app.openapi(publicFundTimelineRoute, async (c) => {
    const fundId = c.req.valid("param").fundId;
    const { actor, publicTier } = await publicFundContext(fundId, c.get("principal"));
    const expenses = await listFundExpenses(fundId);
    const officeholderNamesShown = await deps.displayNameStore.officeholderNamesShown(fundId);
    const items = await Promise.all(
      expenses
        .filter((expense) => expense.status !== "draft")
        .map(async (expense) => {
          const occurredAt =
            expense.reconciledAt ??
            expense.paidAt ??
            expense.rejectedAt ??
            expense.approvedAt ??
            expense.submittedAt ??
            expense.createdAt;
          const statusWords: Record<string, string> = {
            submitted: "A spending request was submitted.",
            approved: "A spending request was approved.",
            rejected: "A spending request was rejected.",
            expired: "A spending request expired.",
            paid: "An approved expense was marked paid.",
            reconciled: "An expense was marked reconciled.",
          };
          const displayName = await deps.displayNameStore.get(fundId, expense.requesterId);
          return {
            id: expense.id,
            occurredAt,
            message: statusWords[expense.status] ?? "A fund activity was recorded.",
            ...(displayName === null
              ? {}
              : {
                  actorDisplayName: displayName,
                  actorNameChoice: officeholderNamesShown
                    ? ("full" as const)
                    : ("initials" as const),
                }),
            ...(expense.status === "paid" || expense.status === "reconciled"
              ? { amountPaise: String(expense.amountPaise) }
              : {}),
            verified: "unverified" as const,
          };
        }),
    ).then((sorted) =>
      sorted.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    );
    const body = redactFundReadModel(actor, {
      kind: "fund_timeline",
      fundId,
      items,
      dataGaps: publicDataGaps,
    });
    setFundReadCache(c, publicTier, body);
    return c.json(body, 200);
  });
  app.openapi(publicExpenseDetailRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const { actor, publicTier, expense, proofs } = await publicExpenseContext(
      fundId,
      expenseId,
      c.get("principal"),
    );
    const payeeName = proofs.find((proof) => proof.vendorName)?.vendorName;
    const body = redactExpenseDetails(actor, {
      kind: "expense_details",
      expenseId: expense.id,
      fundId: expense.fundId,
      amountPaise: paise(expense.amountPaise),
      category: "Uncategorized",
      status: expense.status,
      ...(payeeName === undefined ? {} : { payeeName }),
      payeeVerified: false,
      description: expense.description,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
    });
    setFundReadCache(c, publicTier, body);
    return c.json(body, 200);
  });
  app.openapi(publicExpenseProofsRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const { actor, publicTier, proofs } = await publicExpenseContext(
      fundId,
      expenseId,
      c.get("principal"),
    );
    const proofRecords = await Promise.all(
      proofs.map(async (proof) => {
        if (actor.role === "public") {
          return { sha256: proof.fileSha256, scanStatus: proof.scan.result } as const;
        }
        const storedObject = await getVerifiedEvidenceObject(proof, deps.storageAdapter);
        return {
          sha256: proof.fileSha256,
          scanStatus: proof.scan.result,
          mimeType: proof.mimeType,
          contentBase64: Buffer.from(storedObject.data).toString("base64"),
        } as const;
      }),
    );
    const body = redactExpenseProofs(actor, {
      kind: "expense_proofs",
      expenseId,
      proofs: proofRecords,
    });
    setFundReadCache(c, publicTier, body);
    return c.json(body, 200);
  });

  const defaultFundPolicy: FundPolicy = {
    approvalQuorum: 2,
    objectionWindowHours: 0,
    autoExpireHours: 72,
  };

  const toExpenseView = (exp: ExpenseRequest): z.infer<typeof expenseSchema> => ({
    id: exp.id,
    fundId: exp.fundId,
    requesterId: exp.requesterId,
    amountPaise: String(exp.amountPaise),
    description: exp.description,
    recipientRef: exp.recipientRef,
    status: exp.status,
    holdId: exp.holdId,
    approvalsCount: exp.approvals.length,
    supersedesId: exp.supersedesId,
    submittedAt: exp.submittedAt,
    approvedAt: exp.approvedAt,
    rejectedAt: exp.rejectedAt,
    rejectionReason: exp.rejectionReason,
    expiredAt: exp.expiredAt,
    paidAt: exp.paidAt,
    reconciledAt: exp.reconciledAt,
    bankTransactionId: exp.bankTransactionId,
    createdAt: exp.createdAt,
    updatedAt: exp.updatedAt,
  });

  const authorizedExpense = (
    c: Context<ApiEnv>,
    action: ExpenseAction,
    resource: ExpenseResource,
  ) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    if (principal.assurance === "owner_vouched" && action === "expense:approve") {
      throw new ApiError("forbidden");
    }
    if (!deps.policy.can(principal, action, resource)) {
      throw new ApiError(action === "expense:read" ? "not_found" : "forbidden");
    }
    return principal;
  };

  const redactExpense = (principal: Principal, resource: ExistingExpenseResource): ExpenseView => {
    if (!deps.policy.redactExpense) throw new ApiError("internal");
    return deps.policy.redactExpense(principal, resource);
  };

  app.openapi(createExpenseRoute, async (c) => {
    const principal = authorizedExpense(c, "expense:create", { kind: "expense" });
    const fundIdResult = parseFundId(c.req.valid("param").fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const input = c.req.valid("json");
    const requesterId = await actorFor(principal, fundIdResult.value);
    const amount = paise(Number(input.amountPaise));
    const now = new Date(deps.clock()).toISOString();
    const draft = createDraftRequest({
      id: deps.idGenerator(),
      fundId: fundIdResult.value,
      requesterId,
      amountPaise: amount,
      description: input.description,
      recipientRef: input.recipientRef,
      evidence: input.evidence,
      supersedesId: input.supersedesId,
      createdAt: now,
    });
    await deps.expenseStore.save(draft);
    const view = toExpenseView(draft);
    const resource = { kind: "expense", expense: { owner: principal.id, expense: view } } as const;
    return c.json(redactExpense(principal, resource), 201);
  });

  app.openapi(getExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:read", resource);
    return c.json(redactExpense(principal, resource), 200);
  });

  app.openapi(listExpensesRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const principal = authorizedExpense(c, "expense:read", { kind: "expense" });
    const expenses = await deps.expenseStore.list(fundIdResult.value);
    return c.json(
      expenses.map((exp) =>
        redactExpense(principal, {
          kind: "expense",
          expense: { owner: exp.requesterId, expense: toExpenseView(exp) },
        }),
      ),
      200,
    );
  });

  app.openapi(submitExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:submit", resource);
    if (expense.status !== "draft") {
      throw new ApiError("conflict");
    }
    const now = new Date(deps.clock()).toISOString();
    const actorId = await actorFor(principal, fundIdResult.value);
    const holdId = deps.idGenerator();
    const updated = submitExpense(expense, {
      holdId,
      policy: defaultFundPolicy,
      nowUtc: now,
    });
    const persisted = await deps.expenseStore.save(updated, {
      actorId,
      actorUserId: principal.id,
      policy: defaultFundPolicy,
    });
    const finalExpense = persisted ?? updated;
    const updatedView = toExpenseView(finalExpense);
    return c.json(
      redactExpense(principal, {
        kind: "expense",
        expense: { owner: finalExpense.requesterId, expense: updatedView },
      }),
      200,
    );
  });

  app.openapi(approveExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:approve", resource);
    const approverId = await actorFor(principal, fundIdResult.value);
    if (expense.requesterId === approverId) {
      throw new ApiError("forbidden");
    }
    if (expense.status !== "submitted") {
      throw new ApiError("conflict");
    }
    const input = c.req.valid("json");
    const now = new Date(deps.clock()).toISOString();
    const actionDetails = {
      action: "expense:approve",
      fundId: fundIdResult.value,
      targetId: expenseId,
    };
    await deps.pinService.verifyAction(principal.id, actionDetails, {
      pin: c.req.header("x-approval-pin") ?? input.pin,
      approvalToken: c.req.header("x-approval-token") ?? input.approvalToken,
    });
    const approval: SignedApproval = {
      approverId,
      passkeySignature: {
        credentialId: "pin-proof",
        signatureHex: "00",
        clientDataJson: "verified PIN proof",
        authenticatorDataHex: "00",
      },
      approvedAt: now,
    };
    try {
      const res = await deps.expenseStore.atomicApprove(
        expenseId,
        approval,
        defaultFundPolicy,
        deps.approvalProofVerifier,
        now,
        principal.id,
      );
      await deps.pinNotificationService.notify({
        kind: "approval_executed",
        approverUserId: principal.id,
        actionHash: computeActionHash(actionDetails),
        recipientRoles: ["approver", "owner"],
        actionSummary: actionDetails,
      });
      const updatedView = toExpenseView(res.expense);
      return c.json(
        redactReceipt("fund:expense:approve", {
          status: res.expense.status as "submitted" | "approved",
          expenseId: updatedView.id,
          approvedAt: updatedView.approvedAt,
          approvalsCount: updatedView.approvalsCount,
        }),
        200,
      );
    } catch (err) {
      if (err instanceof SeparationOfDutiesError) throw new ApiError("forbidden");
      if (err instanceof DuplicateApprovalError || err instanceof InvalidStateTransitionError) {
        throw new ApiError("conflict");
      }
      if (err instanceof InvalidPasskeySignatureError) throw new ApiError("validation_failed");
      throw new ApiError("internal");
    }
  });

  app.openapi(rejectExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:reject", resource);
    if (expense.status !== "submitted") {
      throw new ApiError("conflict");
    }
    const input = c.req.valid("json");
    const now = new Date(deps.clock()).toISOString();
    const actorId = await actorFor(principal, fundIdResult.value);
    const actionDetails = {
      action: "expense:reject",
      fundId: fundIdResult.value,
      targetId: expenseId,
    };
    await deps.pinService.verifyAction(principal.id, actionDetails, {
      pin: c.req.header("x-approval-pin") ?? input.pin,
      approvalToken: c.req.header("x-approval-token") ?? input.approvalToken,
    });
    const updated = rejectExpense(expense, input.reason, now);
    const persisted = await deps.expenseStore.save(updated, {
      actorId,
      actorUserId: principal.id,
      policy: defaultFundPolicy,
    });
    const finalExpense = persisted ?? updated;
    await deps.pinNotificationService.notify({
      kind: "approval_executed",
      approverUserId: principal.id,
      actionHash: computeActionHash(actionDetails),
      recipientRoles: ["approver", "owner"],
      actionSummary: actionDetails,
    });
    const updatedView = toExpenseView(finalExpense);
    return c.json(
      redactReceipt("fund:expense:reject", {
        status: "rejected" as const,
        expenseId: updatedView.id,
        reason: updatedView.rejectionReason ?? input.reason,
        rejectedAt: updatedView.rejectedAt ?? now,
      }),
      200,
    );
  });

  app.openapi(payExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:pay", resource);
    if (expense.status !== "approved") {
      throw new ApiError("conflict");
    }
    const input = c.req.valid("json");
    const now = new Date(deps.clock()).toISOString();
    const actorId = await actorFor(principal, fundIdResult.value);
    const updated = payExpense(expense, input.bankTransactionId, now);
    const persisted = await deps.expenseStore.save(updated, {
      actorId,
      actorUserId: principal.id,
      policy: defaultFundPolicy,
    });
    const finalExpense = persisted ?? updated;
    const updatedView = toExpenseView(finalExpense);
    return c.json(
      redactExpense(principal, {
        kind: "expense",
        expense: { owner: finalExpense.requesterId, expense: updatedView },
      }),
      200,
    );
  });

  app.openapi(reconcileExpenseRoute, async (c) => {
    const { fundId, expenseId } = c.req.valid("param");
    const fundIdResult = parseFundId(fundId);
    if (!fundIdResult.ok) throw new ApiError("not_found");
    const expense = await deps.expenseStore.get(expenseId);
    if (!expense || expense.fundId !== fundIdResult.value) {
      throw new ApiError("not_found");
    }
    const view = toExpenseView(expense);
    const resource = {
      kind: "expense",
      expense: { owner: expense.requesterId, expense: view },
    } as const;
    const principal = authorizedExpense(c, "expense:reconcile", resource);
    if (expense.status !== "paid") {
      throw new ApiError("conflict");
    }
    const input = c.req.valid("json");
    const now = new Date(deps.clock()).toISOString();
    const actorId = await actorFor(principal, fundIdResult.value);
    let updated: ExpenseRequest;
    try {
      updated = reconcileExpense(expense, input.bankTransactionId, now);
    } catch (err) {
      if (err instanceof BankTransactionMismatchError) throw new ApiError("conflict");
      throw err;
    }
    await deps.expenseStore.save(updated, {
      actorId,
      actorUserId: principal.id,
      policy: defaultFundPolicy,
    });
    const updatedView = toExpenseView(updated);
    return c.json(
      redactExpense(principal, {
        kind: "expense",
        expense: { owner: updated.requesterId, expense: updatedView },
      }),
      200,
    );
  });
  const donationResource = (id: string) => {
    const fund = funds.get(id);
    if (!fund) throw new ApiError("not_found");
    return { kind: "fund", fund } as const;
  };
  app.openapi(donationDetailsRoute, (c) => {
    const id = parseFundId(c.req.valid("param").fundId);
    if (!id.ok) throw new ApiError("not_found");
    const resource = donationResource(id.value);
    if (!deps.policy.canDonate(resource)) throw new ApiError("not_found");
    return c.json(deps.policy.redactDonationDetails(resource), 200);
  });
  app.openapi(pledgeDonationRoute, async (c) => {
    const id = parseFundId(c.req.valid("param").fundId);
    if (!id.ok) throw new ApiError("not_found");
    const resource = donationResource(id.value);
    if (!deps.policy.canDonate(resource)) throw new ApiError("not_found");
    const input = c.req.valid("json");
    const donorPrincipal = c.get("principal");
    const donorPseudonym = donorPrincipal ? await actorFor(donorPrincipal, id.value) : undefined;
    const donorContact =
      input.donorContact === undefined ? undefined : normalizeWaitlistContact(input.donorContact);
    if (donorContact === null) {
      throw new ApiError("validation_failed", [
        {
          path: ["json", "donorContact"],
          message: "Expected an email address or an Indian mobile number",
        },
      ]);
    }
    const outcome = await deps.donationPledgeStore.pledge({
      fundId: id.value,
      amountPaise: Number(input.amountPaise),
      utr: input.utr,
      ...(input.donorName === undefined ? {} : { donorName: input.donorName }),
      ...(donorContact === undefined ? {} : { donorContact }),
      donorNameChoice: input.donorNameChoice,
      ...(donorPseudonym ? { actorPseudonym: donorPseudonym } : {}),
      ...(donorPrincipal ? { actorUserId: donorPrincipal.id } : {}),
    });
    if (outcome.kind === "duplicate_utr") throw new ApiError("donation_utr_claimed");
    deps.reconciliationStore.addPledge({
      id: outcome.donationId,
      fundId: id.value,
      amountPaise: paise(Number(input.amountPaise)),
      utr: input.utr,
      ...(input.donorName !== undefined ? { donorName: input.donorName } : {}),
      ...(donorContact !== undefined ? { donorContact } : {}),
      status: "pledged",
      createdAt: new Date(deps.clock()).toISOString(),
    });
    return c.json(
      {
        donationId: outcome.donationId,
        fundId: id.value,
        status: "pledged" as const,
        amountPaise: input.amountPaise,
      },
      201,
    );
  });

  const getFundOrNotFound = (fundIdString: string) => {
    const id = parseFundId(fundIdString);
    if (!id.ok) throw new ApiError("not_found");
    const entry = funds.get(id.value);
    if (!entry) throw new ApiError("not_found");
    return { id: id.value, resource: { kind: "fund", fund: entry } as const };
  };

  registerOwnerInviteRoutes(app, deps, getFundOrNotFound, authorizedFund);

  app.openapi(setupPinRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const { pin } = c.req.valid("json");
    await deps.pinService.setupPin(principal.id, pin, { userId: principal.id });
    const session = c.get("session");
    if (session) {
      await deps.authStore.trustDevice(
        session.id,
        principal.id,
        deps.clock(),
        deps.trustedDeviceIdleTimeoutMs,
      );
    }
    return c.json({ status: "created" as const, isSet: true as const }, 201);
  });

  app.openapi(unlockTrustedDeviceRoute, async (c) => {
    const principal = c.get("principal");
    const session = c.get("session");
    if (!principal || !session) throw new ApiError("unauthenticated");
    const { pin } = c.req.valid("json");
    try {
      await deps.pinService.verifyPinForDeviceUnlock(principal.id, pin);
    } catch (error) {
      if (error instanceof ApiError) throw new ApiError("unauthenticated");
      throw error;
    }
    await deps.authStore.trustDevice(
      session.id,
      principal.id,
      deps.clock(),
      deps.trustedDeviceIdleTimeoutMs,
    );
    return c.json({ status: "unlocked" as const }, 200);
  });

  app.openapi(getPinStatusRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const status = await deps.pinService.getPinStatus(principal.id);
    return c.json(status, 200);
  });

  app.openapi(verifyPinRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const { pin, actionHash } = c.req.valid("json");
    const result = await deps.pinService.verifyPin(principal.id, pin, actionHash);
    return c.json(result, 200);
  });

  app.openapi(changePinRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const { currentPin, newPin } = c.req.valid("json");
    await deps.pinService.changePin(principal.id, currentPin, newPin, { userId: principal.id });
    return c.json({ status: "updated" as const }, 200);
  });

  app.openapi(requestPinResetRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const { channel } = c.req.valid("json");
    const result = await deps.pinService.requestReset(principal.id, channel);
    return c.json({ status: "otp_sent" as const, challengeId: result.challengeId }, 200);
  });

  app.openapi(confirmPinResetRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    const { otp, newPin, challengeId } = c.req.valid("json");
    const result = await deps.pinService.confirmReset(
      principal.id,
      otp,
      newPin,
      {
        userId: principal.id,
      },
      challengeId,
    );
    const session = c.get("session");
    if (session) {
      await deps.authStore.trustDevice(
        session.id,
        principal.id,
        deps.clock(),
        deps.trustedDeviceIdleTimeoutMs,
      );
    }
    return c.json({ status: "cooling_off" as const, coolingOffUntil: result.coolingOffUntil }, 200);
  });

  app.openapi(unlockPinRoute, async (c) => {
    const principal = c.get("principal");
    if (!principal) throw new ApiError("unauthenticated");
    if (!deps.policy.can(principal, "fund:member:unlock", { kind: "fund" })) {
      throw new ApiError("forbidden");
    }
    const { targetUserId } = c.req.valid("json");
    await deps.pinService.unlockPin(targetUserId);
    return c.json({ status: "unlocked" as const }, 200);
  });

  app.openapi(changePayeeRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const { id, resource } = getFundOrNotFound(fundId);
    const principal = authorizedFund(c, "fund:payee:change", resource);

    const body = c.req.valid("json");
    const approvalToken = c.req.header("x-approval-token") ?? body.approvalToken;
    const pin = c.req.header("x-approval-pin") ?? body.pin;

    const actionDetails = { action: "payee:change", fundId: id, vpa: body.vpa };
    await deps.pinService.verifyAction(principal.id, actionDetails, { pin, approvalToken });

    return c.json(
      deps.policy.redactReceipt(
        principal,
        "fund:payee:change",
        { status: "updated" as const, vpa: body.vpa },
        resource,
      ),
      200,
    );
  });

  app.openapi(changePolicyRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const { id, resource } = getFundOrNotFound(fundId);
    const principal = authorizedFund(c, "fund:policy:change", resource);

    const body = c.req.valid("json");
    const approvalToken = c.req.header("x-approval-token") ?? body.approvalToken;
    const pin = c.req.header("x-approval-pin") ?? body.pin;

    const actionDetails = { action: "policy:change", fundId: id, policy: body.policyJson };
    await deps.pinService.verifyAction(principal.id, actionDetails, { pin, approvalToken });

    return c.json(
      deps.policy.redactReceipt(
        principal,
        "fund:policy:change",
        { status: "updated" as const, policyJson: body.policyJson },
        resource,
      ),
      200,
    );
  });

  app.openapi(addMemberRoute, async (c) => {
    const { fundId } = c.req.valid("param");
    const { id, resource } = getFundOrNotFound(fundId);
    const principal = authorizedFund(c, "fund:member:add", resource);

    const body = c.req.valid("json");
    const approvalToken = c.req.header("x-approval-token") ?? body.approvalToken;
    const pin = c.req.header("x-approval-pin") ?? body.pin;

    const actionDetails = {
      action: "member:add",
      fundId: id,
      targetId: body.userId,
      role: body.role,
    };
    await deps.pinService.verifyAction(principal.id, actionDetails, { pin, approvalToken });

    return c.json(
      deps.policy.redactReceipt(
        principal,
        "fund:member:add",
        { status: "added" as const, memberId: body.userId, role: body.role },
        resource,
      ),
      201,
    );
  });

  app.openapi(removeMemberRoute, async (c) => {
    const { fundId, memberId } = c.req.valid("param");
    const { id, resource } = getFundOrNotFound(fundId);
    const principal = authorizedFund(c, "fund:member:remove", resource);

    const body = c.req.valid("json");
    const approvalToken = c.req.header("x-approval-token") ?? body?.approvalToken;
    const pin = c.req.header("x-approval-pin") ?? body?.pin;

    const actionDetails = { action: "member:remove", fundId: id, targetId: memberId };
    await deps.pinService.verifyAction(principal.id, actionDetails, { pin, approvalToken });

    return c.json(
      deps.policy.redactReceipt(
        principal,
        "fund:member:remove",
        { status: "removed" as const, memberId },
        resource,
      ),
      200,
    );
  });

  app.openapi(uploadEvidenceRoute, async (c) => {
    const fundParam = parseFundId(c.req.valid("param").fundId);
    if (!fundParam.ok) throw new ApiError("not_found");
    const fundEntry = funds.get(fundParam.value);
    if (!fundEntry) throw new ApiError("not_found");

    const expenseId = c.req.valid("param").expenseId;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(expenseId)) {
      throw new ApiError("not_found");
    }

    const principal = authorizedExpense(c, "expense:add_evidence", {
      kind: "expense",
      fund: fundEntry,
      expenseId,
    });

    const form = c.req.valid("form");
    const file = form.file;
    if (!(file instanceof File)) {
      throw new ApiError("validation_failed", [
        { path: ["form", "file"], message: "Evidence file is required" },
      ]);
    }

    if (!ALLOWED_EVIDENCE_MIME_TYPES.includes(file.type as AllowedEvidenceMimeType)) {
      throw new ApiError("validation_failed", [
        {
          path: ["form", "file"],
          message: `Unsupported MIME type: ${file.type}. Allowed MIME types: ${ALLOWED_EVIDENCE_MIME_TYPES.join(", ")}`,
        },
      ]);
    }

    if (file.size > MAX_EVIDENCE_FILE_SIZE_BYTES) {
      throw new ApiError("payload_too_large");
    }

    let validatedGstin: string | undefined;
    if (form.gstin && form.gstin.trim() !== "") {
      const gstinResult = parseGstin(form.gstin);
      if (!gstinResult.ok) {
        throw new ApiError("validation_failed", [
          { path: ["form", "gstin"], message: gstinResult.error },
        ]);
      }
      validatedGstin = gstinResult.value;
    }

    if (form.invoiceDate && form.invoiceDate.trim() !== "") {
      const dateVal = form.invoiceDate.trim();
      const parsedDate = Date.parse(dateVal);
      if (!Number.isFinite(parsedDate)) {
        throw new ApiError("validation_failed", [
          { path: ["form", "invoiceDate"], message: "Invalid invoice date" },
        ]);
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length > MAX_EVIDENCE_FILE_SIZE_BYTES) {
      throw new ApiError("payload_too_large");
    }

    // Binary signature / magic bytes check to prevent MIME spoofing
    if (!verifyMimeSignature(bytes, file.type)) {
      throw new ApiError("validation_failed", [
        {
          path: ["form", "file"],
          message: "File binary signature does not match declared MIME type",
        },
      ]);
    }

    const evidenceId = deps.idGenerator();
    const objectKey = buildOpaqueEvidenceKey(fundParam.value, expenseId, evidenceId);

    let scanResult: VirusScanResult;
    try {
      scanResult = await deps.virusScanner.scan({ objectKey, data: bytes, mimeType: file.type });
    } catch {
      throw new ApiError("overloaded", [
        {
          path: ["form", "file"],
          message: "Upload quarantined because the malware scanner is unavailable",
        },
      ]);
    }
    if (scanResult.status === "infected") {
      throw new ApiError("validation_failed", [
        { path: ["form", "file"], message: `Malicious file rejected: ${scanResult.threatName}` },
      ]);
    }
    if (scanResult.status === "quarantined") {
      throw new ApiError("overloaded", [
        {
          path: ["form", "file"],
          message: `Upload quarantined because it could not be scanned: ${scanResult.reason}`,
        },
      ]);
    }

    // Server-computed SHA-256 over original trusted bytes (never client claim)
    const fileSha256 = crypto.createHash("sha256").update(bytes).digest("hex");

    // Store raw bytes in durable storage
    await deps.storageAdapter.putObject(objectKey, bytes, file.type);

    // Strip EXIF metadata for served image preview (privacy & safety)
    const _sanitizedPreviewBytes = stripExifMetadata(bytes, file.type);

    // Duplicate detection across expenses ONLY within authorized fund scope (prevent cross-fund disclosure)
    const existingEvidence = await deps.evidenceStore.findBySha256(fundParam.value, fileSha256);
    const duplicateInSameFund = existingEvidence.find((e) => e.expenseId !== expenseId);
    const duplicateDetected = duplicateInSameFund !== undefined;

    const record: StoredEvidence = {
      evidenceId,
      fundId: fundParam.value,
      expenseId,
      fileSha256,
      mimeType: file.type as AllowedEvidenceMimeType,
      fileSizeBytes: bytes.length,
      fileName: sanitizeEvidenceFilename(file.name),
      objectKey,
      duplicateDetected,
      isDuplicate: duplicateDetected,
      duplicateExpenseId: duplicateInSameFund?.expenseId,
      vendorName: form.vendorName?.trim() || undefined,
      gstin: validatedGstin,
      invoiceNumber: form.invoiceNumber?.trim() || undefined,
      invoiceDate: form.invoiceDate?.trim() || undefined,
      createdAt: new Date(deps.clock()).toISOString(),
      scan: {
        scannerName: scanResult.scannerName,
        signatureVersion: scanResult.signatureVersion,
        result: "clean",
      },
    };

    // If an authenticated event log appender is available, atomically record expense.evidence_added
    if (deps.eventAppender) {
      const payload = payloadSchemas["expense.evidence_added"].parse({
        expense_id: expenseId,
        evidence_id: evidenceId,
        content_sha256: fileSha256,
      });
      const actor = await actorFor(principal, fundParam.value);
      await deps.eventAppender({
        fundId: fundParam.value,
        type: "expense.evidence_added",
        version: 1,
        actor,
        occurredAt: record.createdAt,
        payload,
      });
    }

    await deps.evidenceStore.save(record);
    return c.json(deps.policy.redact(principal, { kind: "evidence", evidence: record }), 201);
  });
  app.openapi(getEvidenceRoute, async (c) => {
    const fundParam = parseFundId(c.req.valid("param").fundId);
    if (!fundParam.ok) throw new ApiError("not_found");
    const fundEntry = funds.get(fundParam.value);
    if (!fundEntry) throw new ApiError("not_found");

    const expenseId = c.req.valid("param").expenseId;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(expenseId)) {
      throw new ApiError("not_found");
    }

    const principal = authorizedExpense(c, "expense:read_evidence", {
      kind: "expense",
      fund: fundEntry,
      expenseId,
    });

    const evidence = await deps.evidenceStore.getByExpense(fundParam.value, expenseId);
    for (const item of evidence) await getVerifiedEvidenceObject(item, deps.storageAdapter);
    return c.json(deps.policy.redact(principal, { kind: "evidence_list", evidence }), 200);
  });
  app.openapi(statementUploadRoute, async (c) => {
    const input = c.req.valid("json");
    const id = parseFundId(input.fundId);
    if (!id.ok) throw new ApiError("not_found");
    const entry = funds.get(id.value);
    if (!entry) throw new ApiError("not_found");
    const resource = { kind: "fund", fund: entry } as const;
    const principal = authorizedFund(c, "fund:reconcile", resource);

    let transactions: ReturnType<typeof parseBankStatementCsv>;
    try {
      transactions = parseBankStatementCsv(input.csvContent, id.value);
    } catch {
      throw new ApiError("validation_failed", [
        { path: ["json", "csvContent"], message: "Unable to parse bank statement CSV" },
      ]);
    }

    const result = await deps.reconciliationStore.ingest(transactions);
    const wireTransactions = result.transactions.map((t) => ({
      ...t,
      amountPaise: String(t.amountPaise),
    }));

    const redact = <T>(value: T): T => value;
    return c.json(
      redact(
        deps.policy.redactStatementResult(principal, resource, {
          totalProcessed: result.totalProcessed,
          ingestedCount: result.ingestedCount,
          matchedCount: result.matchedCount,
          unmatchedCount: result.unmatchedCount,
          duplicateCount: result.duplicateCount,
          transactions: wireTransactions,
        }),
      ),
      200,
    );
  });
  app.openapi(partnerWebhookRoute, async (c) => {
    const raw = c.req.valid("json");
    const parsed = normalizePartnerWebhook(raw);
    const result = await deps.reconciliationStore.ingest([parsed]);
    const summary = result.transactions[0];

    return c.json(
      {
        status: "processed" as const,
        duplicate: summary?.duplicate ?? false,
        transactionId: summary?.id ?? "",
        reconciliationStatus: summary?.reconciliationStatus ?? "unmatched",
        ...(summary?.matchedPledgeId !== undefined
          ? { matchedPledgeId: summary.matchedPledgeId }
          : {}),
      },
      200,
    );
  });
  app.openapi(unmatchedCreditsRoute, async (c) => {
    const id = parseFundId(c.req.valid("param").fundId);
    if (!id.ok) throw new ApiError("not_found");
    const entry = funds.get(id.value);
    if (!entry) throw new ApiError("not_found");
    const resource = { kind: "fund", fund: entry } as const;
    const principal = authorizedFund(c, "fund:reconcile", resource);

    const credits = await deps.reconciliationStore.getUnmatchedCredits(id.value);
    const wireCredits = credits.map((cr) => ({
      ...cr,
      amountPaise: String(cr.amountPaise),
      candidates: cr.candidates.map((cand) => ({
        ...cand,
        amountPaise: String(cand.amountPaise),
      })),
    }));

    const redact = <T>(value: T): T => value;
    return c.json(
      redact(deps.policy.redactUnmatchedCredits(principal, resource, wireCredits)),
      200,
    );
  });
  app.openapi(manualMatchRoute, async (c) => {
    const id = parseFundId(c.req.valid("param").fundId);
    if (!id.ok) throw new ApiError("not_found");
    const entry = funds.get(id.value);
    if (!entry) throw new ApiError("not_found");
    const resource = { kind: "fund", fund: entry } as const;
    const principal = authorizedFund(c, "fund:reconcile", resource);
    const input = c.req.valid("json");

    const matchOutcome = await deps.reconciliationStore.manualMatch({
      fundId: id.value,
      bankTransactionId: input.bankTransactionId,
      pledgeId: input.pledgeId,
      reason: input.reason,
      actorPseudonym: principal.id,
    });

    if (
      matchOutcome.kind === "bank_transaction_not_found" ||
      matchOutcome.kind === "pledge_not_found"
    ) {
      throw new ApiError("not_found");
    }
    if (matchOutcome.kind === "already_matched") {
      throw new ApiError("conflict");
    }
    if (matchOutcome.kind === "amount_mismatch") {
      throw new ApiError("validation_failed", [
        {
          path: ["json", "pledgeId"],
          message: `Amount mismatch: bank transaction is ${matchOutcome.expectedPaise} paise, pledge is ${matchOutcome.actualPaise} paise`,
        },
      ]);
    }

    const redact = <T>(value: T): T => value;
    return c.json(
      redact(
        deps.policy.redactManualMatch(principal, resource, {
          status: "matched" as const,
          bankTransactionId: matchOutcome.bankTransactionId,
          pledgeId: matchOutcome.pledgeId,
          amountPaise: String(matchOutcome.amountPaise),
          matchedAt: matchOutcome.matchedAt,
        }),
      ),
      200,
    );
  });
  app.openapi(openapiRoute, (c) => c.json(openapiSchema.parse(openApiDocument(app)), 200));
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Session token authentication via Bearer header or yen_session httpOnly cookie.",
  });
  return app;
}

function invalidOrExpiredCode(): ApiError {
  return new ApiError("validation_failed", [
    { path: ["body", "code"], message: "Invalid or expired code" },
  ]);
}

export function openApiDocument(
  app = createApp(),
): ReturnType<OpenAPIHono<ApiEnv>["getOpenAPI31Document"]> {
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Yen API",
      version: "1.0.0",
      description:
        "YEN-15 foundation contract. Funds are explicit in-memory stubs. Paise uses decimal strings.",
    },
  });
}
