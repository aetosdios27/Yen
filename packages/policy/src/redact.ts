import { type Paise, type PseudonymId, paiseWire, parsePseudonymId } from "@yen/shared";
import { isValidPaiseAmount } from "./policy.js";
import { type Actor, type FundRole, isStaffRole, isValidRole } from "./roles.js";

declare const RedactedSymbol: unique symbol;

/**
 * A value that has passed through redaction before leaving the API boundary.
 * The brand is required: a raw, unredacted record is not assignable to `Redacted<T>`.
 * Only `redact(...)` produces it, plus `unsafeMarkRedactedForDevPolicy` for the dev policy.
 */
export type Redacted<T> = T & { readonly [RedactedSymbol]: true };

function markRedacted<T>(value: T): Redacted<T> {
  return value as Redacted<T>;
}

/**
 * Narrow hook for `apps/api`'s dev-only policy (`devPolicy`), which has no redaction engine.
 * Do not call it from production code: it skips field allowlisting entirely.
 */
export function unsafeMarkRedactedForDevPolicy<T>(value: T): Redacted<T> {
  return markRedacted(value);
}

export type RedactionErrorCode = "UNSUPPORTED_RECORD_SHAPE" | "INVALID_AMOUNT";

/** Thrown instead of returning a partially understood or malformed record. */
export class RedactionError extends Error {
  readonly code: RedactionErrorCode;

  constructor(
    message = "Unsupported record shape for redaction",
    code: RedactionErrorCode = "UNSUPPORTED_RECORD_SHAPE",
  ) {
    super(message);
    this.name = "RedactionError";
    this.code = code;
  }
}

/**
 * Masks a personal display name to uppercase initials separated by periods.
 * Example: "Jane Doe" -> "J. D.", "Aarav" -> "A."
 *
 * Primary reference:
 * ICO Pseudonymisation guidance:
 * https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/pseudonymisation/
 * DPDP Act 2023, Section 6 (purpose limitation & data minimization):
 * https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf
 */
export function maskNameToInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts.map((part) => `${part[0]?.toUpperCase()}.`).join(" ");
}

export interface ViewerContext {
  readonly id?: string | undefined;
  readonly role?: FundRole | undefined;
}

export interface EvidenceRecord {
  readonly evidenceId?: string | undefined;
  readonly contentSha256: string;
  readonly fileUrl?: string | undefined;
  readonly filename?: string | undefined;
  readonly mimeType?: string | undefined;
}

export interface ExpenseRecord {
  readonly expenseId: string;
  readonly fundId: string;
  readonly amountPaise: Paise;
  readonly payeeName?: string | undefined;
  readonly requesterDisplayName?: string | undefined;
  readonly requesterPseudonymId?: PseudonymId | undefined;
  readonly evidence?: readonly EvidenceRecord[] | undefined;
  readonly notes?: string | undefined;
  readonly createdAt: string;
}

export interface DonationRecord {
  readonly donationId: string;
  readonly fundId: string;
  readonly amountPaise: Paise;
  readonly donorDisplayName?: string | undefined;
  /** Explicit choice attached to this donation; omitted legacy records stay pseudonymous. */
  readonly donorNameChoice?: "full" | "initials" | "anonymous" | undefined;
  readonly donorPhone?: string | undefined;
  readonly donorEmail?: string | undefined;
  readonly donorPseudonymId: PseudonymId;
  readonly bankTransactionId?: string | undefined;
  readonly createdAt: string;
}

function selectedDonationName(record: DonationRecord): string | undefined {
  if (record.donorNameChoice === undefined) return undefined;
  if (record.donorNameChoice === "anonymous") return "A donor";
  const name = optionalStr(record.donorDisplayName);
  if (name === undefined) return "A donor";
  return record.donorNameChoice === "full" ? name : maskNameToInitials(name) || "A donor";
}

export type FundVerificationState = "bank-matched" | "anchored" | "unverified";
export interface FundSummaryRecord {
  readonly kind: "fund_summary";
  readonly fundId: string;
  readonly name: string;
  readonly purpose: string | null;
  readonly raisedPaise: string | null;
  readonly spentPaise: string;
  readonly verification: FundVerificationState;
  readonly dataGaps: readonly string[];
}
export interface FundBreakdownRecord {
  readonly kind: "fund_breakdown";
  readonly fundId: string;
  readonly categories: readonly { readonly category: string; readonly spentPaise: string }[];
  readonly dataGaps: readonly string[];
}
export interface FundTimelineRecord {
  readonly kind: "fund_timeline";
  readonly fundId: string;
  readonly items: readonly {
    readonly id: string;
    readonly occurredAt: string;
    readonly message: string;
    readonly actorDisplayName?: string | undefined;
    readonly actorNameChoice?: "full" | "initials" | undefined;
    readonly amountPaise?: string | undefined;
    readonly verified: FundVerificationState;
  }[];
  readonly dataGaps: readonly string[];
}
export type FundReadRecord = FundSummaryRecord | FundBreakdownRecord | FundTimelineRecord;

export type ExpenseReadStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "expired"
  | "paid"
  | "reconciled";

export interface ExpenseProofReadRecord {
  readonly sha256: string;
  readonly scanStatus: "clean" | "infected" | "unavailable";
  readonly mimeType?: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | undefined;
  readonly contentBase64?: string | undefined;
}

export interface ExpenseDetailsReadRecord {
  readonly kind: "expense_details";
  readonly expenseId: string;
  readonly fundId: string;
  readonly amountPaise: Paise;
  readonly category: string;
  readonly status: ExpenseReadStatus;
  readonly payeeName?: string | undefined;
  readonly payeeVerified: boolean;
  readonly requesterDisplayName?: string | undefined;
  readonly description?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExpenseProofsReadRecord {
  readonly kind: "expense_proofs";
  readonly expenseId: string;
  readonly proofs: readonly ExpenseProofReadRecord[];
}

export type ExpenseDetailsReadView = Omit<
  ExpenseDetailsReadRecord,
  "kind" | "payeeVerified" | "amountPaise"
> & { readonly amountPaise: string };
export type ExpenseProofReadView = ExpenseProofReadRecord;
export type ExpenseProofsReadView = {
  readonly expenseId: string;
  readonly proofs: ExpenseProofReadView[];
};

interface FundViewShape {
  readonly id: string;
  readonly name: string;
  readonly purpose?: string | undefined;
  readonly visibility?: string | undefined;
  readonly targetPaise?: string | undefined;
  readonly createdAt?: string | undefined;
}

function isFundView(value: unknown): value is FundViewShape {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.name === "string";
}

/** Fund view allowlist: id, name, target and creation time. Everything else is dropped. */
function redactFundView(fund: FundViewShape): FundViewShape {
  const result: {
    id: string;
    name: string;
    purpose?: string;
    visibility?: string;
    targetPaise?: string;
    createdAt?: string;
  } = {
    id: fund.id,
    name: fund.name,
  };
  if (fund.purpose !== undefined) result.purpose = str(fund.purpose);
  if (fund.visibility !== undefined) result.visibility = str(fund.visibility);
  if (fund.targetPaise !== undefined) {
    if (!paiseWire.safeParse(fund.targetPaise).success) {
      throw new RedactionError(
        "targetPaise must be a canonical non-negative integer string",
        "INVALID_AMOUNT",
      );
    }
    result.targetPaise = fund.targetPaise;
  }
  if (fund.createdAt !== undefined) {
    result.createdAt = str(fund.createdAt);
  }
  return result;
}

function isExpenseRecord(value: unknown): value is ExpenseRecord {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.expenseId === "string" &&
    typeof obj.fundId === "string" &&
    "amountPaise" in obj &&
    typeof obj.createdAt === "string"
  );
}

function isDonationRecord(value: unknown): value is DonationRecord {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.donationId === "string" &&
    typeof obj.fundId === "string" &&
    "donorPseudonymId" in obj &&
    "amountPaise" in obj &&
    typeof obj.createdAt === "string"
  );
}

function str(value: unknown): string {
  if (typeof value !== "string") {
    throw new RedactionError("Expected a string field in record");
  }
  return value;
}

function optionalStr(value: unknown): string | undefined {
  return value === undefined ? undefined : str(value);
}

function requirePaise(amount: unknown): Paise {
  if (!isValidPaiseAmount(amount)) {
    throw new RedactionError("amountPaise must be a safe non-negative integer", "INVALID_AMOUNT");
  }
  return amount;
}

function pseudonym(value: unknown): PseudonymId {
  const result = parsePseudonymId(str(value));
  if (!result.ok) throw new RedactionError("Invalid pseudonym id");
  return result.value;
}

function optionalPseudonym(value: unknown): PseudonymId | undefined {
  return value === undefined ? undefined : pseudonym(value);
}

function maskedName(value: unknown): string | undefined {
  return value === undefined ? undefined : maskNameToInitials(str(value));
}

/** Non-staff evidence contains only the content hash. Staff also get file details. */
function evidenceFor(evidence: unknown, staff: boolean): EvidenceRecord[] | undefined {
  if (evidence === undefined) return undefined;
  if (!Array.isArray(evidence)) {
    throw new RedactionError("evidence must be an array");
  }
  return evidence.map((entry: unknown): EvidenceRecord => {
    if (!entry || typeof entry !== "object") {
      throw new RedactionError("Invalid evidence entry");
    }
    const ev = entry as Record<string, unknown>;
    const hashOnly = { contentSha256: str(ev.contentSha256) };
    if (!staff) return hashOnly;
    return {
      ...hashOnly,
      evidenceId: optionalStr(ev.evidenceId),
      fileUrl: optionalStr(ev.fileUrl),
      filename: optionalStr(ev.filename),
      mimeType: optionalStr(ev.mimeType),
    };
  });
}

/**
 * Pure field-level redaction engine.
 * Every viewer gets a freshly built object containing only the fields listed for that viewer:
 * - Public: names appear as initials, donors are pseudonymous (PII stripped),
 *   bills/evidence are hash-only (contentSha256 only; URLs & filenames removed).
 * - Donors: names are masked, donations pseudonymous, and evidence hash-only.
 * - Staff (owner/treasurer/approver/auditor): view the full internal record.
 * Unknown fields are dropped. Unsupported or malformed records are rejected with a
 * RedactionError instead of being returned.
 *
 * OWASP Top 10 API Security Risks 2023 - API3:2023 Broken Object Property Level Authorization:
 * https://api-security.owasp.org/editions/2023/en/0x11-t10/
 */
export function redact(
  viewer: Actor | ViewerContext,
  record: ExpenseRecord,
): Redacted<ExpenseRecord>;
export function redact(
  viewer: Actor | ViewerContext,
  record: DonationRecord,
): Redacted<DonationRecord>;
export function redact(
  viewer: Actor | ViewerContext,
  record: { readonly kind: "fund"; readonly fund: object },
): Redacted<FundViewShape>;
export function redact(
  viewer: Actor | ViewerContext,
  record: FundViewShape,
): Redacted<FundViewShape>;
export function redact(
  viewer: Actor | ViewerContext,
  record: unknown,
): Redacted<ExpenseRecord | DonationRecord | FundViewShape>;
export function redact(
  viewer: Actor | ViewerContext,
  record: unknown,
): Redacted<ExpenseRecord | DonationRecord | FundViewShape> {
  // Unknown or missing viewer roles are treated as public (least privilege).
  const viewerRole: FundRole =
    viewer && typeof viewer === "object" && isValidRole(viewer.role) ? viewer.role : "public";
  const isPublic = viewerRole === "public";
  const isDonor = viewerRole === "donor" || viewerRole === "member";
  const isStaff = isStaffRole(viewerRole);

  if (typeof record !== "object" || record === null) {
    throw new RedactionError("Unsupported primitive record for redaction");
  }

  const recordObj = record as Record<string, unknown>;

  // 1. Wrapped API resource: { kind: "fund", fund: { owner: string, fund: FundView } } or { kind: "fund", fund: FundView }
  if (recordObj.kind === "fund" && recordObj.fund && typeof recordObj.fund === "object") {
    const wrapper = recordObj.fund as Record<string, unknown>;
    const inner =
      wrapper.fund && typeof wrapper.fund === "object"
        ? (wrapper.fund as Record<string, unknown>)
        : wrapper;

    if (!isFundView(inner)) {
      throw new RedactionError("Wrapped fund resource missing valid fund view");
    }
    return markRedacted(redactFundView(inner));
  }

  // 2. Direct FundView
  if (isFundView(recordObj) && !("expenseId" in recordObj) && !("donationId" in recordObj)) {
    return markRedacted(redactFundView(recordObj));
  }

  // 3. ExpenseRecord
  if (isExpenseRecord(recordObj)) {
    const exp = recordObj;
    const amountPaise = requirePaise(exp.amountPaise);

    if (isPublic) {
      const result: ExpenseRecord = {
        expenseId: str(exp.expenseId),
        fundId: str(exp.fundId),
        amountPaise,
        payeeName: maskedName(exp.payeeName),
        requesterDisplayName: maskedName(exp.requesterDisplayName),
        requesterPseudonymId: optionalPseudonym(exp.requesterPseudonymId),
        evidence: evidenceFor(exp.evidence, false),
        createdAt: str(exp.createdAt),
      };
      return markRedacted(result);
    }

    if (isDonor) {
      const requesterPseudonymId = optionalPseudonym(exp.requesterPseudonymId);

      const result: ExpenseRecord = {
        expenseId: str(exp.expenseId),
        fundId: str(exp.fundId),
        amountPaise,
        payeeName: maskedName(exp.payeeName),
        requesterDisplayName: maskedName(exp.requesterDisplayName),
        requesterPseudonymId,
        evidence: evidenceFor(exp.evidence, false),
        createdAt: str(exp.createdAt),
      };
      return markRedacted(result);
    }

    if (isStaff) {
      const result: ExpenseRecord = {
        expenseId: str(exp.expenseId),
        fundId: str(exp.fundId),
        amountPaise,
        payeeName: optionalStr(exp.payeeName),
        requesterDisplayName: optionalStr(exp.requesterDisplayName),
        requesterPseudonymId: optionalPseudonym(exp.requesterPseudonymId),
        evidence: evidenceFor(exp.evidence, true),
        notes: optionalStr(exp.notes),
        createdAt: str(exp.createdAt),
      };
      return markRedacted(result);
    }
  }

  // 4. DonationRecord
  if (isDonationRecord(recordObj)) {
    const don = recordObj;
    const amountPaise = requirePaise(don.amountPaise);
    const donorPseudonymId = pseudonym(don.donorPseudonymId);

    if (isPublic) {
      const result: DonationRecord = {
        donationId: str(don.donationId),
        fundId: str(don.fundId),
        amountPaise,
        donorPseudonymId,
        ...(don.donorNameChoice === undefined
          ? {}
          : { donorDisplayName: selectedDonationName(don) }),
        createdAt: str(don.createdAt),
      };
      return markRedacted(result);
    }

    if (isDonor) {
      const result: DonationRecord = {
        donationId: str(don.donationId),
        fundId: str(don.fundId),
        amountPaise,
        donorPseudonymId,
        ...(don.donorNameChoice === undefined
          ? {}
          : { donorDisplayName: selectedDonationName(don) }),
        createdAt: str(don.createdAt),
      };
      return markRedacted(result);
    }

    if (isStaff) {
      const result: DonationRecord = {
        donationId: str(don.donationId),
        fundId: str(don.fundId),
        amountPaise,
        donorPseudonymId,
        donorDisplayName: optionalStr(don.donorDisplayName),
        donorPhone: optionalStr(don.donorPhone),
        donorEmail: optionalStr(don.donorEmail),
        bankTransactionId: optionalStr(don.bankTransactionId),
        createdAt: str(don.createdAt),
      };
      return markRedacted(result);
    }
  }

  // 5. Unsupported record shape: fail closed
  throw new RedactionError("Unsupported record shape for redaction");
}

/** Allowlist redaction for the public fund read API's aggregate projections. */
export function redactFundReadModel<T extends FundReadRecord>(
  _viewer: Actor | ViewerContext,
  record: T,
): Redacted<Omit<T, "kind">> {
  if (!record || typeof record !== "object" || typeof record.fundId !== "string") {
    throw new RedactionError("Unsupported fund read model");
  }
  const dataGaps = Array.isArray(record.dataGaps) ? record.dataGaps.map((gap) => str(gap)) : [];
  let result: FundReadRecord;
  if (record.kind === "fund_summary") {
    result = {
      kind: "fund_summary",
      fundId: str(record.fundId),
      name: publicText(record.name),
      purpose: record.purpose === null ? null : publicText(record.purpose),
      raisedPaise: record.raisedPaise === null ? null : paiseString(record.raisedPaise),
      spentPaise: paiseString(record.spentPaise),
      verification: verificationState(record.verification),
      dataGaps,
    };
  } else if (record.kind === "fund_breakdown") {
    result = {
      kind: "fund_breakdown",
      fundId: str(record.fundId),
      categories: record.categories.map((item) => ({
        category: publicText(item.category),
        spentPaise: paiseString(item.spentPaise),
      })),
      dataGaps,
    };
  } else if (record.kind === "fund_timeline") {
    result = {
      kind: "fund_timeline",
      fundId: str(record.fundId),
      items: record.items.map((item) => ({
        id: str(item.id),
        occurredAt: str(item.occurredAt),
        message: publicText(item.message),
        ...(item.actorDisplayName === undefined
          ? {}
          : {
              actorDisplayName:
                item.actorNameChoice === "full"
                  ? publicText(str(item.actorDisplayName))
                  : maskNameToInitials(str(item.actorDisplayName)),
            }),
        ...(item.amountPaise === undefined ? {} : { amountPaise: paiseString(item.amountPaise) }),
        verified: verificationState(item.verified),
      })),
      dataGaps,
    };
  } else {
    throw new RedactionError("Unsupported fund read model");
  }
  const { kind: _kind, ...safe } = result;
  return markRedacted(safe as unknown as Omit<T, "kind">);
}

/** Role-aware allowlist for a single expense read. Public payees are generic and only shown
 * after an explicit verification signal; names, descriptions, and other free text stay private. */
export function redactExpenseDetails(
  viewer: Actor | ViewerContext,
  record: ExpenseDetailsReadRecord,
): Redacted<ExpenseDetailsReadView> {
  const role = viewerRole(viewer);
  const base: ExpenseDetailsReadView = {
    expenseId: str(record.expenseId),
    fundId: str(record.fundId),
    amountPaise: String(requirePaise(record.amountPaise)),
    category: safeText(record.category),
    status: expenseStatus(record.status),
    createdAt: str(record.createdAt),
    updatedAt: str(record.updatedAt),
  };

  if (role === "public") {
    return markRedacted({
      ...base,
      ...(record.payeeVerified ? { payeeName: "Vendor (verified)" } : {}),
    });
  }

  const result: ExpenseDetailsReadView = {
    ...base,
    ...(optionalSafeText(record.payeeName) === undefined
      ? {}
      : { payeeName: optionalSafeText(record.payeeName) }),
  };
  if (role === "donor") return markRedacted(result);

  return markRedacted({
    ...result,
    ...(optionalSafeText(record.requesterDisplayName) === undefined
      ? {}
      : { requesterDisplayName: optionalSafeText(record.requesterDisplayName) }),
    ...(optionalSafeText(record.description) === undefined
      ? {}
      : { description: optionalSafeText(record.description) }),
  });
}

/** Evidence names and object keys are never part of the read model. Only donor and member
 * tiers receive verified file bytes; every tier can receive the pinned hash and scan result. */
export function redactExpenseProofs(
  viewer: Actor | ViewerContext,
  record: ExpenseProofsReadRecord,
): Redacted<ExpenseProofsReadView> {
  const role = viewerRole(viewer);
  const canReadFiles = role !== "public";
  return markRedacted({
    expenseId: str(record.expenseId),
    proofs: record.proofs.map((proof) => {
      const metadata: ExpenseProofReadView = {
        sha256: sha256(proof.sha256),
        scanStatus: scanStatus(proof.scanStatus),
      };
      if (!canReadFiles) return metadata;
      return {
        ...metadata,
        ...(proof.mimeType === undefined ? {} : { mimeType: proofMimeType(proof.mimeType) }),
        ...(proof.contentBase64 === undefined
          ? {}
          : { contentBase64: base64(proof.contentBase64) }),
      };
    }),
  });
}

function viewerRole(viewer: Actor | ViewerContext): FundRole {
  return viewer && typeof viewer === "object" && isValidRole(viewer.role) ? viewer.role : "public";
}

function expenseStatus(value: unknown): ExpenseReadStatus {
  if (
    value === "draft" ||
    value === "submitted" ||
    value === "approved" ||
    value === "rejected" ||
    value === "expired" ||
    value === "paid" ||
    value === "reconciled"
  ) {
    return value;
  }
  throw new RedactionError("Invalid expense status");
}

function scanStatus(value: unknown): ExpenseProofReadRecord["scanStatus"] {
  if (value === "clean" || value === "infected" || value === "unavailable") return value;
  throw new RedactionError("Invalid evidence scan status");
}

function proofMimeType(value: unknown): NonNullable<ExpenseProofReadRecord["mimeType"]> {
  if (
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/webp" ||
    value === "application/pdf"
  ) {
    return value;
  }
  throw new RedactionError("Invalid evidence MIME type");
}

function sha256(value: unknown): string {
  const hash = str(value);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new RedactionError("Invalid evidence SHA-256 hash");
  return hash;
}

function base64(value: unknown): string {
  const encoded = str(value);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new RedactionError("Invalid base64 evidence payload");
  }
  return encoded;
}

function optionalSafeText(value: unknown): string | undefined {
  return value === undefined ? undefined : safeText(value);
}

function safeText(value: unknown): string {
  return str(value)
    .replace(/\b[a-z0-9._-]{2,}@[a-z0-9.-]{2,}\b/gi, "[redacted]")
    .replace(
      /\b(?:utr|transaction\s*(?:id|reference)|account\s*(?:number|no\.?))\s*[:#-]?\s*[a-z0-9-]{4,}\b/gi,
      "[redacted]",
    )
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[redacted]")
    .replace(/\b\d{9,18}\b/g, "[redacted]");
}

function verificationState(value: unknown): FundVerificationState {
  if (value === "bank-matched" || value === "anchored" || value === "unverified") return value;
  throw new RedactionError("Invalid verification state");
}

function paiseString(value: unknown): string {
  const parsed = paiseWire.safeParse(value);
  if (!parsed.success) {
    throw new RedactionError("Expected canonical paise string", "INVALID_AMOUNT");
  }
  return parsed.data;
}

function publicText(value: unknown): string {
  return str(value)
    .replace(/\bhttps?:\/\/\S+/gi, "[redacted]")
    .replace(/\b[a-z0-9._-]{2,}@[a-z0-9.-]{2,}\b/gi, "[redacted]")
    .replace(
      /\b(?:utr|transaction\s*(?:id|reference)|account\s*(?:number|no\.?))\s*[:#-]?\s*[a-z0-9-]{6,}\b/gi,
      "[redacted]",
    )
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[redacted]");
}
