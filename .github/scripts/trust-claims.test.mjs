import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { checkTrustClaims } from "./check-trust-claims.mjs";

const files = {
  "README.md": "Claim text\n",
  "packages/a/src/x.ts": "export const x = 1;\n",
  "packages/a/src/x.test.ts": 'it("does the thing", () => {});\n',
};
const anchors = new Set(["rfc-6962"]);
const readFile = (path) => files[path];

const valid = {
  Status: "enforced",
  Wording: '"Claim text"',
  Where: "README.md:1",
  Mechanism: "`packages/a/src/x.ts` `x`",
  Test: 'packages/a/src/x.test.ts "does the thing"',
  Reference: "`rfc-6962`",
  Mutation: "Removed x; the test failed.",
};

const claim = (id, fields) =>
  `### ${id} Title\n\n${Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `- **${name}:** ${value}`)
    .join("\n")}\n`;

const check = (sections, readmes = {}) =>
  checkTrustClaims(sections, { anchors, readmes, readFile });

test("repository register and README markers pass the guard", () => {
  execFileSync(process.execPath, [".github/scripts/check-trust-claims.mjs"], { stdio: "pipe" });
});

test("accepts a well-formed enforced row and a planned row", () => {
  const planned = {
    Status: "planned",
    Wording: '"Future"',
    Where: "README.md:1",
    Mechanism: "none",
    Test: "none",
    Reference: "none yet (gap)",
    Missing: "Nothing is built.",
  };
  assert.deepEqual(check(claim("CLAIM-01", valid) + claim("CLAIM-02", planned)), []);
});

test("rejects a test name that does not exist in its file", () => {
  const broken = { ...valid, Test: 'packages/a/src/x.test.ts "renamed away"' };
  assert.match(check(claim("CLAIM-01", broken)).join(), /test name not found.*renamed away/);
});

test("rejects a test file that does not exist", () => {
  const broken = { ...valid, Test: 'packages/a/src/gone.test.ts "does the thing"' };
  assert.match(check(claim("CLAIM-01", broken)).join(), /test file does not exist/);
});

test("rejects an unknown reference anchor", () => {
  const broken = { ...valid, Reference: "`rfc-9999`" };
  assert.match(check(claim("CLAIM-01", broken)).join(), /unknown reference anchor rfc-9999/);
});

test("rejects a status outside the three values", () => {
  const broken = { ...valid, Status: "done" };
  assert.match(check(claim("CLAIM-01", broken)).join(), /status must be one of/);
});

test("rejects an enforced row without a test", () => {
  const broken = { ...valid, Test: "none" };
  assert.match(check(claim("CLAIM-01", broken)).join(), /enforced row has no test/);
});

test("rejects an enforced row whose mechanism names no file", () => {
  const broken = { ...valid, Mechanism: "`x`" };
  assert.match(check(claim("CLAIM-01", broken)).join(), /names no source file/);
});

test("rejects a partial or planned row that does not say what is missing", () => {
  const broken = { ...valid, Status: "partial", Missing: undefined };
  assert.match(check(claim("CLAIM-01", broken)).join(), /must say what is missing/);
});

test("rejects a Where line past the end of its file", () => {
  const broken = { ...valid, Where: "README.md:99" };
  assert.match(check(claim("CLAIM-01", broken)).join(), /past end of file/);
});

test("rejects a README marker with no register entry", () => {
  assert.match(
    check(claim("CLAIM-01", valid), { "README.md": "<!-- claim: CLAIM-09 -->" }).join(),
    /claim marker CLAIM-09 has no register entry/,
  );
  assert.deepEqual(
    check(claim("CLAIM-01", valid), { "README.md": "<!-- claim: CLAIM-01 -->" }),
    [],
  );
});

test("rejects duplicate claim IDs", () => {
  assert.match(check(claim("CLAIM-01", valid) + claim("CLAIM-01", valid)).join(), /duplicate/);
});
