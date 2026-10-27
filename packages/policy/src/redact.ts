import type { PseudonymId } from "@yen/shared";
import type { Actor, FundRole } from "./roles.js";

declare const RedactedSymbol: unique symbol;

/**
 * A branded type indicating that a data structure has passed through field-level redaction
 * before leaving the API boundary.
 */
export type Redacted<T> = T & { readonly [RedactedSymbol]?: true };

export function markRedacted<T>(value: T): Redacted<T> {
  return value as Redacted<T>;
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
  readonly evidenceId: string;
  readonly contentSha256: string;
  readonly fileUrl?: string | undefined;
  readonly filename?: string | undefined;
  readonly mimeType?: string | undefined;
}

export interface ExpenseRecord {
  readonly expenseId: string;
  readonly fundId: string;
  readonly amountPaise: string | bigint | number;
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
  readonly amountPaise: string | bigint | number;
  readonly donorDisplayName?: string | undefined;
  readonly donorPhone?: string | undefined;
  readonly donorEmail?: string | undefined;
  readonly donorPseudonymId: PseudonymId;
  readonly bankTransactionId?: string | undefined;
  readonly createdAt: string;
}

/**
 * Pure field-level redaction engine.
 * Applies public masking rules based on viewer role:
 * - Public: names appear as initials, donors are pseudonymous (PII stripped),
 *   bills/evidence are hash-only (contentSha256 only; URLs & filenames removed).
 * - Donors: can see donor-level information, but other donors remain pseudonymous.
 * - Staff (owner/treasurer/approver/auditor): view full internal record.
 *
 * OWASP Top 10 API Security Risks 2023 - API3:2023 Broken Object Property Level Authorization:
 * https://api-security.owasp.org/editions/2023/en/0x11-t10/
 */
export function redact<T>(viewer: Actor | ViewerContext, record: T): Redacted<T> {
  const role: FundRole = viewer.role ?? "public";
  const isPublic = role === "public";
  const isDonor = role === "donor";

  if (typeof record !== "object" || record === null) {
    return markRedacted(record);
  }

  // Handle wrapped API resource: { kind: "fund", fund: { owner: string, fund: FundView } }
  const recordObj = record as Record<string, unknown>;
  if (recordObj.kind === "fund" && recordObj.fund && typeof recordObj.fund === "object") {
    const wrappedFund = recordObj.fund as Record<string, unknown>;
    if (wrappedFund.fund && typeof wrappedFund.fund === "object") {
      const innerFund = wrappedFund.fund as Record<string, unknown>;
      return markRedacted(innerFund as T);
    }
    return markRedacted(wrappedFund as T);
  }

  // Handle ExpenseRecord
  if ("expenseId" in recordObj && "amountPaise" in recordObj) {
    const exp = recordObj as unknown as ExpenseRecord;
    if (isPublic) {
      const redactedEvidence = exp.evidence?.map((ev) => ({
        evidenceId: ev.evidenceId,
        contentSha256: ev.contentSha256,
      }));

      const result: ExpenseRecord = {
        expenseId: exp.expenseId,
        fundId: exp.fundId,
        amountPaise: exp.amountPaise,
        payeeName: exp.payeeName ? maskNameToInitials(exp.payeeName) : undefined,
        requesterDisplayName: exp.requesterDisplayName
          ? maskNameToInitials(exp.requesterDisplayName)
          : undefined,
        requesterPseudonymId: exp.requesterPseudonymId,
        evidence: redactedEvidence,
        notes: undefined, // internal notes redacted for public
        createdAt: exp.createdAt,
      };
      return markRedacted(result as T);
    }

    if (isDonor) {
      // Donors see notes and hash-only evidence
      const redactedEvidence = exp.evidence?.map((ev) => ({
        evidenceId: ev.evidenceId,
        contentSha256: ev.contentSha256,
      }));
      const result: ExpenseRecord = {
        ...exp,
        payeeName: exp.payeeName ? maskNameToInitials(exp.payeeName) : undefined,
        evidence: redactedEvidence,
      };
      return markRedacted(result as T);
    }

    return markRedacted({ ...exp } as T);
  }

  // Handle DonationRecord
  if ("donationId" in recordObj && "donorPseudonymId" in recordObj) {
    const don = recordObj as unknown as DonationRecord;
    if (isPublic) {
      // Donors are strictly pseudonymous to the public:
      // Strip displayName, phone, email, bankTransactionId
      const result: DonationRecord = {
        donationId: don.donationId,
        fundId: don.fundId,
        amountPaise: don.amountPaise,
        donorPseudonymId: don.donorPseudonymId,
        donorDisplayName: undefined,
        donorPhone: undefined,
        donorEmail: undefined,
        bankTransactionId: undefined,
        createdAt: don.createdAt,
      };
      return markRedacted(result as T);
    }

    if (isDonor) {
      // If the viewer is the donor themselves, they can see their details, otherwise pseudonymous
      const isSelf = viewer.id !== undefined && don.donorPseudonymId === viewer.id;
      if (!isSelf) {
        const result: DonationRecord = {
          ...don,
          donorDisplayName: undefined,
          donorPhone: undefined,
          donorEmail: undefined,
          bankTransactionId: undefined,
        };
        return markRedacted(result as T);
      }
    }

    return markRedacted({ ...don } as T);
  }

  // Default passthrough for other records marked as redacted
  return markRedacted({ ...record });
}
