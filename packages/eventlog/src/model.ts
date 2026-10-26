import { fundIdSchema, type Result } from "@yen/shared";
import * as z from "zod/mini";
import { canonicalize } from "./canonical.js";

const uuid = z.string().check(z.regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/));
const orgId = uuid.brand<"OrgId">();
export const pseudonymIdSchema = z
  .string()
  .check(z.regex(/^psn_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/))
  .brand<"PseudonymId">();
export type PseudonymId = z.infer<typeof pseudonymIdSchema>;
const donationId = uuid.brand<"DonationId">();
const expenseId = uuid.brand<"ExpenseId">();
const evidenceId = uuid.brand<"EvidenceId">();
const objectionId = uuid.brand<"ObjectionId">();
const bankTransactionId = uuid.brand<"BankTransactionId">();
const discrepancyId = uuid.brand<"DiscrepancyId">();
const anchorId = uuid.brand<"AnchorId">();
const hex32 = z.string().check(z.regex(/^[0-9a-f]{64}$/));
const positiveInt = z.int().check(z.minimum(1), z.maximum(Number.MAX_SAFE_INTEGER));
const nonnegativeInt = z.int().check(z.minimum(0), z.maximum(Number.MAX_SAFE_INTEGER));
const signedInt = z
  .int()
  .check(z.minimum(-Number.MAX_SAFE_INTEGER), z.maximum(Number.MAX_SAFE_INTEGER));

function isUtcMillisecondInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

export const occurredAtSchema = z.string().check(z.refine(isUtcMillisecondInstant));
export const hashHexSchema = hex32.brand<"EventHashHex">();
export type EventHashHex = z.infer<typeof hashHexSchema>;
export const actorPseudonymSchema = pseudonymIdSchema;
export type ActorPseudonymId = PseudonymId;

export const payloadSchemas = {
  "fund.created": z.strictObject({
    org_id: orgId,
    visibility: z.enum(["private", "members", "public"]),
  }),
  "fund.policy_changed": z.strictObject({
    approval_quorum: positiveInt,
    objection_window_hours: nonnegativeInt,
  }),
  "fund.visibility_changed": z.strictObject({
    visibility: z.enum(["private", "members", "public"]),
  }),
  "member.added": z.strictObject({
    member_id: pseudonymIdSchema,
    role: z.enum(["member", "approver", "treasurer"]),
  }),
  "member.removed": z.strictObject({ member_id: pseudonymIdSchema }),
  "donation.pledged": z.strictObject({ donation_id: donationId, amount_paise: positiveInt }),
  "donation.verified": z.strictObject({
    donation_id: donationId,
    bank_transaction_id: bankTransactionId,
  }),
  "donation.rejected": z.strictObject({
    donation_id: donationId,
    reason: z.enum(["unmatched", "duplicate", "cancelled"]),
  }),
  "expense.submitted": z.strictObject({ expense_id: expenseId, amount_paise: positiveInt }),
  "expense.evidence_added": z.strictObject({
    expense_id: expenseId,
    evidence_id: evidenceId,
    content_sha256: hex32,
  }),
  "expense.flagged": z.strictObject({
    expense_id: expenseId,
    reason: z.enum(["missing_evidence", "policy", "suspicious"]),
  }),
  "expense.objection_raised": z.strictObject({ expense_id: expenseId, objection_id: objectionId }),
  "expense.objection_resolved": z.strictObject({
    expense_id: expenseId,
    objection_id: objectionId,
    resolution: z.enum(["upheld", "dismissed"]),
  }),
  "expense.approved": z.strictObject({ expense_id: expenseId }),
  "expense.rejected": z.strictObject({
    expense_id: expenseId,
    reason: z.enum(["quorum", "objection", "policy"]),
  }),
  "expense.expired": z.strictObject({ expense_id: expenseId }),
  "expense.paid": z.strictObject({ expense_id: expenseId, bank_transaction_id: bankTransactionId }),
  "expense.reversed": z.strictObject({
    expense_id: expenseId,
    bank_transaction_id: bankTransactionId,
  }),
  "bank.credit_seen": z.strictObject({
    bank_transaction_id: bankTransactionId,
    amount_paise: positiveInt,
  }),
  "bank.debit_seen": z.strictObject({
    bank_transaction_id: bankTransactionId,
    amount_paise: positiveInt,
  }),
  "bank.balance_checked": z.strictObject({ balance_paise: signedInt }),
  "discrepancy.raised": z.strictObject({
    discrepancy_id: discrepancyId,
    bank_transaction_id: bankTransactionId,
    kind: z.enum(["unmatched_credit", "unmatched_debit", "balance_mismatch"]),
  }),
  "discrepancy.resolved": z.strictObject({
    discrepancy_id: discrepancyId,
    resolution: z.enum(["matched", "corrected", "dismissed"]),
  }),
  "anchor.published": z.strictObject({ anchor_id: anchorId, global_root: hex32 }),
} as const;

const envelope = {
  fund_id: fundIdSchema,
  seq: positiveInt,
  version: z.literal(1),
  actor: pseudonymIdSchema,
  occurred_at: occurredAtSchema,
  prev_hash: hashHexSchema,
  hash: hashHexSchema,
};

const eventSchema = z.union([
  z.strictObject({
    ...envelope,
    type: z.literal("fund.created"),
    payload: payloadSchemas["fund.created"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("fund.policy_changed"),
    payload: payloadSchemas["fund.policy_changed"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("fund.visibility_changed"),
    payload: payloadSchemas["fund.visibility_changed"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("member.added"),
    payload: payloadSchemas["member.added"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("member.removed"),
    payload: payloadSchemas["member.removed"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("donation.pledged"),
    payload: payloadSchemas["donation.pledged"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("donation.verified"),
    payload: payloadSchemas["donation.verified"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("donation.rejected"),
    payload: payloadSchemas["donation.rejected"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("expense.submitted"),
    payload: payloadSchemas["expense.submitted"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("expense.evidence_added"),
    payload: payloadSchemas["expense.evidence_added"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("expense.flagged"),
    payload: payloadSchemas["expense.flagged"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("expense.objection_raised"),
    payload: payloadSchemas["expense.objection_raised"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("expense.objection_resolved"),
    payload: payloadSchemas["expense.objection_resolved"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("expense.approved"),
    payload: payloadSchemas["expense.approved"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("expense.rejected"),
    payload: payloadSchemas["expense.rejected"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("expense.expired"),
    payload: payloadSchemas["expense.expired"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("expense.paid"),
    payload: payloadSchemas["expense.paid"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("expense.reversed"),
    payload: payloadSchemas["expense.reversed"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("bank.credit_seen"),
    payload: payloadSchemas["bank.credit_seen"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("bank.debit_seen"),
    payload: payloadSchemas["bank.debit_seen"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("bank.balance_checked"),
    payload: payloadSchemas["bank.balance_checked"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("discrepancy.raised"),
    payload: payloadSchemas["discrepancy.raised"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("discrepancy.resolved"),
    payload: payloadSchemas["discrepancy.resolved"],
  }),
  z.strictObject({
    ...envelope,
    type: z.literal("anchor.published"),
    payload: payloadSchemas["anchor.published"],
  }),
]);

export type Event = z.infer<typeof eventSchema>;
type WithoutChain<T> = T extends Event ? Omit<T, "seq" | "prev_hash" | "hash"> : never;
type WithoutHash<T> = T extends Event ? Omit<T, "hash"> : never;
export type EventInput = WithoutChain<Event>;
export type UnsignedEvent = WithoutHash<Event>;

const unsignedEventSchema = z.strictObject({
  fund_id: fundIdSchema,
  seq: positiveInt,
  type: z.string(),
  version: z.literal(1),
  actor: pseudonymIdSchema,
  occurred_at: occurredAtSchema,
  payload: z.unknown(),
  prev_hash: hashHexSchema,
});
const unsignedEventKeys = new Set([
  "fund_id",
  "seq",
  "type",
  "version",
  "actor",
  "occurred_at",
  "payload",
  "prev_hash",
]);

export function parseUnsignedEvent(input: unknown): Result<UnsignedEvent> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Invalid unsigned event envelope: exactly eight fields required" };
  }
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== unsignedEventKeys.size ||
    keys.some((key) => typeof key !== "string" || !unsignedEventKeys.has(key))
  ) {
    return { ok: false, error: "Invalid unsigned event envelope: exactly eight fields required" };
  }
  try {
    canonicalize(input);
  } catch {
    return { ok: false, error: "Unsigned event contains a non-canonical JSON value" };
  }
  const parsed = unsignedEventSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Invalid unsigned event envelope: exactly eight fields required" };
  const event = parseEvent({ ...parsed.data, hash: "0".repeat(64) });
  if (!event.ok) return { ok: false, error: `Invalid unsigned event envelope: ${event.error}` };
  const { hash: _hash, ...unsigned } = event.value;
  return { ok: true, value: unsigned };
}

export function parseEvent(input: unknown): Result<Event> {
  try {
    canonicalize(input);
  } catch {
    return { ok: false, error: "Event contains a non-canonical JSON value" };
  }
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Invalid event envelope, type, version, or payload" };
  try {
    canonicalize(parsed.data);
    return { ok: true, value: parsed.data };
  } catch {
    return { ok: false, error: "Event contains a non-canonical JSON value" };
  }
}

export function isUtcEventTime(input: unknown): input is string {
  return typeof input === "string" && isUtcMillisecondInstant(input);
}

export function eventSubjectId(event: Event): string {
  switch (event.type) {
    case "fund.created":
    case "fund.policy_changed":
    case "fund.visibility_changed":
      return event.fund_id;
    case "member.added":
    case "member.removed":
      return event.payload.member_id;
    case "donation.pledged":
    case "donation.verified":
    case "donation.rejected":
      return event.payload.donation_id;
    case "expense.submitted":
    case "expense.evidence_added":
    case "expense.flagged":
    case "expense.objection_raised":
    case "expense.objection_resolved":
    case "expense.approved":
    case "expense.rejected":
    case "expense.expired":
    case "expense.paid":
    case "expense.reversed":
      return event.payload.expense_id;
    case "bank.credit_seen":
    case "bank.debit_seen":
      return event.payload.bank_transaction_id;
    case "bank.balance_checked":
      return event.fund_id;
    case "discrepancy.raised":
    case "discrepancy.resolved":
      return event.payload.discrepancy_id;
    case "anchor.published":
      return event.payload.anchor_id;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
