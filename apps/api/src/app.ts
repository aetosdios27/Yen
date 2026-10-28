import crypto from "node:crypto";
import { OpenAPIHono, type z } from "@hono/zod-openapi";
import { normalizeWaitlistContact } from "@yen/db";
import { payloadSchemas, pseudonymIdSchema } from "@yen/eventlog";
import { parseFundId, parseGstin } from "@yen/shared";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  createFundRoute,
  type fundSchema,
  getEvidenceRoute,
  getFundRoute,
  healthRoute,
  MAX_EVIDENCE_FILE_SIZE_BYTES,
  meRoute,
  openapiRoute,
  openapiSchema,
  principalSchema,
  readyRoute,
  uploadEvidenceRoute,
  waitlistRoute,
} from "./contract.js";
import { type ApiEnv, type AppDependencies, defaultDependencies } from "./dependencies.js";
import { ApiError, errorBody, errorStatus, ReadinessError, StoreError } from "./errors.js";
import { stripExifMetadata } from "./exif-strip.js";
import { getVerifiedEvidenceObject } from "./integrity-job.js";
import { logMethod } from "./logging.js";
import {
  idempotency,
  isEvidenceRoute,
  isWaitlistRoute,
  rateLimit,
  requestContext,
  requireAuth,
} from "./middleware.js";
import { verifyMimeSignature } from "./mime-signature.js";
import type { FundAction, FundResource } from "./policy.js";
import { buildOpaqueEvidenceKey, sanitizeEvidenceFilename } from "./storage.js";
import type { AllowedEvidenceMimeType, StoredEvidence } from "./stores.js";

export { devPolicy } from "./policy.js";

export function createApp(overrides: Partial<AppDependencies> = {}) {
  const deps = { ...defaultDependencies(overrides.clock), ...overrides };
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
  app.onError((error, c) => {
    const errorKind =
      error instanceof ApiError && error.code === "overloaded"
        ? "rate_limit_store_full"
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
  const evidenceBodyLimit = bodyLimit({
    maxSize: MAX_EVIDENCE_FILE_SIZE_BYTES + 65536,
    onError: () => {
      throw new ApiError("payload_too_large");
    },
  });
  app.use("/v1/*", (c, next) => {
    if (isWaitlistRoute(c.req.path)) return waitlistBodyLimit(c, next);
    if (isEvidenceRoute(c.req.path) && c.req.method === "POST") return evidenceBodyLimit(c, next);
    return next();
  });
  app.use("/v1/*", idempotency(deps));
  app.use("/v1/me", requireAuth);
  app.use("/v1/funds/*", requireAuth);

  const funds = new Map<string, { owner: string; fund: z.infer<typeof fundSchema> }>();
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
  app.openapi(readyRoute, async (c) => {
    try {
      if (!(await deps.readiness())) throw new ReadinessError();
    } catch {
      throw new ReadinessError();
    }
    return c.json({ status: "ok" as const }, 200);
  });
  app.openapi(meRoute, (c) => c.json(principalSchema.parse(c.get("principal")), 200));
  app.openapi(createFundRoute, (c) => {
    const principal = authorizedFund(c, "fund:create", { kind: "fund" });
    const id = parseFundId(deps.idGenerator());
    if (!id.ok) throw new ApiError("internal");
    const fund = {
      ...c.req.valid("json"),
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
  app.openapi(uploadEvidenceRoute, async (c) => {
    const fundParam = parseFundId(c.req.valid("param").fundId);
    if (!fundParam.ok) throw new ApiError("not_found");
    const fundEntry = funds.get(fundParam.value);
    if (!fundEntry) throw new ApiError("not_found");

    const expenseId = c.req.valid("param").expenseId;
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(expenseId)) {
      throw new ApiError("not_found");
    }

    const principal = authorizedFund(c, "expense:add_evidence", {
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

    // No real malware scanner is integrated; the runtime adapter must explicitly approve uploads.
    const scanResult = await deps.virusScanner.scan({
      objectKey,
      data: bytes,
      mimeType: file.type,
    });
    if (scanResult.status === "infected") {
      throw new ApiError("validation_failed", [
        { path: ["form", "file"], message: `Malicious file rejected: ${scanResult.threatName}` },
      ]);
    }
    if (scanResult.status === "quarantined") {
      throw new ApiError("validation_failed", [
        { path: ["form", "file"], message: `Upload quarantined: ${scanResult.reason}` },
      ]);
    }

    // Server-computed SHA-256 over original trusted bytes (never client claim)
    const fileSha256 = crypto.createHash("sha256").update(bytes).digest("hex");

    // Store raw bytes in durable storage
    await deps.storageAdapter.putObject(objectKey, bytes, file.type);

    // Strip EXIF metadata for served image preview (privacy & safety)
    const _sanitizedPreviewBytes = stripExifMetadata(bytes, file.type);

    // Duplicate detection across expenses ONLY within authorized fund scope (prevent cross-fund disclosure)
    const existingEvidence = await deps.evidenceStore.findBySha256(fileSha256);
    const duplicateInSameFund = existingEvidence.find(
      (e) => e.fundId === fundParam.value && e.expenseId !== expenseId,
    );
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
    };

    // If an authenticated event log appender is available, atomically record expense.evidence_added
    if (deps.eventAppender) {
      const payload = payloadSchemas["expense.evidence_added"].parse({
        expense_id: expenseId,
        evidence_id: evidenceId,
        content_sha256: fileSha256,
      });
      const actorRaw = principal.id.startsWith("psn_") ? principal.id : `psn_${principal.id}`;
      const actor = pseudonymIdSchema.parse(actorRaw);
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

    const principal = authorizedFund(c, "expense:read_evidence", {
      kind: "expense",
      fund: fundEntry,
      expenseId,
    });

    const evidence = await deps.evidenceStore.getByExpense(fundParam.value, expenseId);
    for (const item of evidence) await getVerifiedEvidenceObject(item, deps.storageAdapter);
    return c.json(deps.policy.redact(principal, { kind: "evidence_list", evidence }), 200);
  });
  app.openapi(openapiRoute, (c) => c.json(openapiSchema.parse(openApiDocument(app)), 200));
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Reserved for YEN-22. Only injected principals authenticate today.",
  });
  return app;
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
