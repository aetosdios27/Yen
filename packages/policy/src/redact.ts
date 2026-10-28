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
  readonly donorPhone?: string | undefined;
  readonly donorEmail?: string | undefined;
  readonly donorPseudonymId: PseudonymId;
  readonly bankTransactionId?: string | undefined;
  readonly createdAt: string;
}

interface FundViewShape {
  readonly id: string;
  readonly name: string;
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
  const result: { id: string; name: string; targetPaise?: string; createdAt?: string } = {
    id: fund.id,
    name: fund.name,
  };
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
  const isDonor = viewerRole === "donor";
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
