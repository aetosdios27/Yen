import type { PhoneE164 } from "@yen/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  fundRowSchema,
  idempotencyKeyRowSchema,
  membershipRowSchema,
  orgRowSchema,
  pseudonymRowSchema,
  type UserRow,
  userApprovalPinRowSchema,
  userRowSchema,
} from "./rows.js";
import { uuidv7 } from "./uuidv7.js";

const id = uuidv7();
const now = new Date();
const fund = {
  id,
  org_id: id,
  title: "Festival",
  target_paise: 0n,
  visibility_tier: "donors",
  policy_json: { approvers: 2 },
  status: "active",
  created_at: now,
};

describe("row parsing at the database boundary", () => {
  it("rejects malformed or noncanonical shared IDs", () => {
    const user = {
      id,
      phone: "+919000000001",
      display_name: "Owner",
      locale: "en",
      created_at: now,
    };
    expect(userRowSchema.safeParse({ ...user, id: "invalid" }).success).toBe(false);
    expect(
      userRowSchema.safeParse({ ...user, id: "AAAAAAAA-AAAA-7AAA-8AAA-AAAAAAAAAAAA" }).success,
    ).toBe(false);
    expect(
      orgRowSchema.safeParse({
        id,
        name: "Club",
        legal_form: "club",
        owner_id: "invalid",
        created_at: now,
      }).success,
    ).toBe(false);
    expect(fundRowSchema.safeParse({ ...fund, org_id: null }).success).toBe(false);
  });

  it("requires bigint paise and rejects negative values", () => {
    expect(fundRowSchema.parse(fund).target_paise).toBe(0n);
    for (const target_paise of [1, "1", -1n, 1.5]) {
      expect(fundRowSchema.safeParse({ ...fund, target_paise }).success).toBe(false);
    }
  });

  it("requires canonical E.164 phone values in user rows", () => {
    expectTypeOf<UserRow["phone"]>().toEqualTypeOf<PhoneE164>();
    const user = { id, display_name: "Owner", locale: "en", created_at: now };
    expect(userRowSchema.safeParse({ ...user, phone: "+919876543210" }).success).toBe(true);
    for (const phone of ["9876543210", "+91 98765 43210", ""]) {
      expect(userRowSchema.safeParse({ ...user, phone }).success).toBe(false);
    }
  });

  it("rejects invalid enums and non-JSON values", () => {
    expect(fundRowSchema.safeParse({ ...fund, visibility_tier: "secret" }).success).toBe(false);
    expect(fundRowSchema.safeParse({ ...fund, policy_json: { amount: 1n } }).success).toBe(false);
    expect(
      membershipRowSchema.safeParse({
        fund_id: id,
        user_id: id,
        role: "admin",
        status: "active",
        created_at: now,
      }).success,
    ).toBe(false);
    expect(pseudonymRowSchema.safeParse({ pseudonym_id: "invalid", user_id: id }).success).toBe(
      false,
    );
    expect(
      idempotencyKeyRowSchema.safeParse({
        key: "key",
        request_hash: "hash",
        response: undefined,
        created_at: now,
      }).success,
    ).toBe(false);
  });

  it("validates approval pin rows and rejects invalid statuses or negative attempts", () => {
    const pin = {
      user_id: id,
      salt: "1234567890abcdef",
      pin_hash: "$2b$10$abcdefghijklmnopqrstuvwxyz0123456789",
      failed_attempts: 0,
      total_failed_24h: 0,
      first_failed_at: null,
      locked_until: null,
      cooling_off_until: null,
      status: "active" as const,
      created_at: now,
      updated_at: now,
    };
    expect(userApprovalPinRowSchema.safeParse(pin).success).toBe(true);
    expect(userApprovalPinRowSchema.safeParse({ ...pin, status: "unknown" }).success).toBe(false);
    expect(userApprovalPinRowSchema.safeParse({ ...pin, failed_attempts: -1 }).success).toBe(false);
    expect(userApprovalPinRowSchema.safeParse({ ...pin, total_failed_24h: -1 }).success).toBe(
      false,
    );
    expect(userApprovalPinRowSchema.safeParse({ ...pin, user_id: "not-a-uuid" }).success).toBe(
      false,
    );
  });
});
