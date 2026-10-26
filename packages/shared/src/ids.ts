import * as z from "zod/mini";

const uuidSchema = z
  .string()
  .check(z.length(36), z.regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/));
export const fundIdSchema = uuidSchema.brand<"FundId">();
const orgIdSchema = uuidSchema.brand<"OrgId">();
const userIdSchema = uuidSchema.brand<"UserId">();

export type FundId = z.infer<typeof fundIdSchema>;
export type OrgId = z.infer<typeof orgIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;

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
