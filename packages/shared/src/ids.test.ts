import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type FundId,
  fundIdSchema,
  type OrgId,
  orgIdSchema,
  type PseudonymId,
  parseFundId,
  parseOrgId,
  parsePseudonymId,
  parseUserId,
  pseudonymIdSchema,
  type UserId,
  userIdSchema,
} from "./ids.js";
import { parseFundId as parseMerkleFundId } from "./merkle/proof.js";

describe.each([parseOrgId, parseFundId, parseUserId])("ID parser %s", (parse) => {
  it.each([
    "019a1122-3344-7556-899a-bbccddeeff00",
    "550e8400-e29b-41d4-a716-446655440000",
    "00000000-0000-0000-0000-000000000001",
  ])("accepts canonical lowercase UUID %s", (value) => {
    expect(parse(value)).toEqual({ ok: true, value });
  });

  it.each([
    undefined,
    null,
    42,
    {},
    "",
    "019A1122-3344-7556-899A-BBCCDDEEFF00",
    "019a112233447556899abbccddeeff00",
    "019a1122-3344-7556-899a-bbccddeeff0g",
    " 019a1122-3344-7556-899a-bbccddeeff00",
    "019a1122-3344-7556-899a-bbccddeeff00\n",
  ])("rejects noncanonical input %j", (value) => {
    expect(parse(value)).toEqual({ ok: false, error: "Expected a canonical lowercase UUID" });
  });
});

describe("PseudonymId parser", () => {
  it.each([
    "psn_019a1122-3344-7556-899a-bbccddeeff00",
    "psn_550e8400-e29b-41d4-a716-446655440000",
    "psn_00000000-0000-0000-0000-000000000001",
  ])("accepts canonical pseudonym %s", (value) => {
    expect(parsePseudonymId(value)).toEqual({ ok: true, value });
  });

  it.each([
    undefined,
    null,
    42,
    {},
    "",
    "019a1122-3344-7556-899a-bbccddeeff00", // missing psn_ prefix
    "psn_019A1122-3344-7556-899A-BBCCDDEEFF00",
    "psn_019a112233447556899abbccddeeff00",
    "psn_019a1122-3344-7556-899a-bbccddeeff0g",
  ])("rejects noncanonical pseudonym %j", (value) => {
    expect(parsePseudonymId(value)).toEqual({
      ok: false,
      error: "Expected a canonical pseudonym ID (psn_<uuid>)",
    });
  });
});

it("exports schemas that accept only canonical lowercase UUIDs", () => {
  for (const schema of [fundIdSchema, orgIdSchema, userIdSchema]) {
    expect(schema.safeParse("019a1122-3344-7556-899a-bbccddeeff00").success).toBe(true);
    expect(schema.safeParse("019A1122-3344-7556-899A-BBCCDDEEFF00").success).toBe(false);
    expect(schema.safeParse("019a112233447556899abbccddeeff00").success).toBe(false);
  }
  expect(pseudonymIdSchema.safeParse("psn_019a1122-3344-7556-899a-bbccddeeff00").success).toBe(
    true,
  );
  expect(pseudonymIdSchema.safeParse("019a1122-3344-7556-899a-bbccddeeff00").success).toBe(false);
});

it("keeps ID brands distinct and uses the same FundId at the Merkle boundary", () => {
  expectTypeOf<OrgId>().not.toExtend<FundId>();
  expectTypeOf<OrgId>().not.toExtend<UserId>();
  expectTypeOf<FundId>().not.toExtend<UserId>();
  expectTypeOf<UserId>().not.toExtend<FundId>();
  expectTypeOf<PseudonymId>().not.toExtend<UserId>();
  expectTypeOf<PseudonymId>().not.toExtend<FundId>();
  expectTypeOf<string>().not.toExtend<OrgId>();
  expectTypeOf<string>().not.toExtend<FundId>();
  expectTypeOf<string>().not.toExtend<UserId>();
  expectTypeOf<string>().not.toExtend<PseudonymId>();
  expect(parseMerkleFundId).toBe(parseFundId);
});
