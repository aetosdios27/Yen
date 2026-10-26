import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type FundId,
  type OrgId,
  parseFundId,
  parseOrgId,
  parseUserId,
  type UserId,
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

it("keeps ID brands distinct and uses the same FundId at the Merkle boundary", () => {
  expectTypeOf<OrgId>().not.toExtend<FundId>();
  expectTypeOf<OrgId>().not.toExtend<UserId>();
  expectTypeOf<FundId>().not.toExtend<UserId>();
  expectTypeOf<UserId>().not.toExtend<FundId>();
  expectTypeOf<string>().not.toExtend<OrgId>();
  expectTypeOf<string>().not.toExtend<FundId>();
  expectTypeOf<string>().not.toExtend<UserId>();
  expect(parseMerkleFundId).toBe(parseFundId);
});
