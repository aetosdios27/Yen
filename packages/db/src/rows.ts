import { parseFundId, parseOrgId, parsePhoneE164, parseUserId } from "@yen/shared";
import * as z from "zod";

function brandedId<T>(
  parse: (input: unknown) => { ok: true; value: T } | { ok: false; error: string },
) {
  return z.unknown().transform((input, context) => {
    const result = parse(input);
    if (result.ok) return result.value;
    context.addIssue({ code: "custom", message: result.error });
    return z.NEVER;
  });
}

const userId = brandedId(parseUserId);
const orgId = brandedId(parseOrgId);
const fundId = brandedId(parseFundId);
const phoneE164 = brandedId(parsePhoneE164);

export const userRowSchema = z.object({
  id: userId,
  phone: phoneE164,
  display_name: z.string(),
  locale: z.string(),
  created_at: z.date(),
});

export const orgRowSchema = z.object({
  id: orgId,
  name: z.string(),
  legal_form: z.string(),
  owner_id: userId,
  created_at: z.date(),
});

export const fundRowSchema = z.object({
  id: fundId,
  org_id: orgId,
  title: z.string(),
  target_paise: z.bigint().nonnegative().nullable(),
  visibility_tier: z.enum(["public", "donors", "members", "private"]),
  policy_json: z.json(),
  status: z.enum(["draft", "active", "closed"]),
  created_at: z.date(),
});

export const membershipRowSchema = z.object({
  fund_id: fundId,
  user_id: userId,
  role: z.enum(["owner", "treasurer", "approver", "auditor", "member"]),
  status: z.enum(["invited", "active", "removed"]),
  created_at: z.date(),
});

export const pseudonymRowSchema = z.object({
  pseudonym_id: z.uuid(),
  user_id: userId,
});

export const idempotencyKeyRowSchema = z.object({
  key: z.string(),
  request_hash: z.string(),
  response: z.json(),
  created_at: z.date(),
});

export type UserRow = z.infer<typeof userRowSchema>;
export type OrgRow = z.infer<typeof orgRowSchema>;
export type FundRow = z.infer<typeof fundRowSchema>;
export type MembershipRow = z.infer<typeof membershipRowSchema>;
export type PseudonymRow = z.infer<typeof pseudonymRowSchema>;
export type IdempotencyKeyRow = z.infer<typeof idempotencyKeyRowSchema>;
