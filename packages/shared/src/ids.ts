import * as z from "zod/mini";

const uuidSchema = z
  .string()
  .check(z.length(36), z.regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/));
export const fundIdSchema = uuidSchema.brand<"FundId">();
export const orgIdSchema = uuidSchema.brand<"OrgId">();
export const userIdSchema = uuidSchema.brand<"UserId">();

const pseudonymRegex = /^psn_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const pseudonymIdSchema = z
  .string()
  .check(z.length(40), z.regex(pseudonymRegex))
  .brand<"PseudonymId">();

export type FundId = z.infer<typeof fundIdSchema>;
export type OrgId = z.infer<typeof orgIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type PseudonymId = z.infer<typeof pseudonymIdSchema>;

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function parseFundId(input: unknown): Result<FundId> {
  const parsed = fundIdSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "Expected a canonical lowercase UUID" };
}

export function parseOrgId(input: unknown): Result<OrgId> {
  const parsed = orgIdSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "Expected a canonical lowercase UUID" };
}

export function parseUserId(input: unknown): Result<UserId> {
  const parsed = userIdSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "Expected a canonical lowercase UUID" };
}

export function parsePseudonymId(input: unknown): Result<PseudonymId> {
  const parsed = pseudonymIdSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "Expected a canonical pseudonym ID (psn_<uuid>)" };
}
