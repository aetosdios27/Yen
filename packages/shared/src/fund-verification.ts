import * as z from "zod";

export const fundVerificationSchema = z.enum(["bank-matched", "anchored", "unverified"]);
export type FundVerificationState = z.infer<typeof fundVerificationSchema>;

/** Coverage is non-vacuous: an empty fund has no verified financial records. */
export function fundVerificationState(
  matchedIds: readonly string[],
  anchoredIds: ReadonlySet<string>,
  hasUnreconciledPayments = false,
): FundVerificationState {
  if (matchedIds.length === 0) return "unverified";
  return !hasUnreconciledPayments && matchedIds.every((id) => anchoredIds.has(id))
    ? "anchored"
    : "bank-matched";
}
