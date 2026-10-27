import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { markRedacted, type Redacted } from "@yen/policy";
import { type FundId, parseFundId } from "@yen/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { FundView } from "./policy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function asFundId(id: string): FundId {
  const parsed = parseFundId(id);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/**
 * Scans route handler source text to verify that any route handler dealing with fund data
 * returns its response through `redact(...)` (e.g. `deps.policy.redact(...)` or `redact(...)`).
 */
function scanRouteHandlersForRedaction(sourceText: string): string[] {
  const violations: string[] = [];

  // Match app.openapi(routeIdentifier, ...)
  const routeRegex = /app\.openapi\s*\(\s*([a-zA-Z0-9_]+)\s*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
  let match: RegExpExecArray | null = null;

  while (true) {
    match = routeRegex.exec(sourceText);
    if (match === null) break;

    const routeName = match[1] ?? "";
    const startIndex = match.index + match[0].length - 1; // index of '{'

    // Extract balanced curly-brace block for this handler
    let braceDepth = 1;
    let endIndex = startIndex + 1;
    while (endIndex < sourceText.length && braceDepth > 0) {
      const ch = sourceText[endIndex];
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      endIndex++;
    }

    const handlerBody = sourceText.slice(startIndex, endIndex);

    // Identify if route touches fund data
    const isFundRoute =
      routeName.toLowerCase().includes("fund") ||
      handlerBody.includes('"/v1/funds') ||
      handlerBody.includes("authorizedFund") ||
      handlerBody.includes("funds.get") ||
      handlerBody.includes("funds.set");

    if (isFundRoute) {
      // Find all return c.json(...) statements in this handler
      const returnJsonRegex = /return\s+c\.json\s*\(([\s\S]*?)\);/g;
      let returnMatch: RegExpExecArray | null = null;
      let hasReturn = false;
      let hasRedactedReturn = false;

      while (true) {
        returnMatch = returnJsonRegex.exec(handlerBody);
        if (returnMatch === null) break;

        hasReturn = true;
        const returnArg = returnMatch[1] ?? "";
        if (returnArg.includes(".redact(") || returnArg.includes("redact(")) {
          hasRedactedReturn = true;
        }
      }

      if (hasReturn && !hasRedactedReturn) {
        violations.push(
          `Route ${routeName} returns fund data without passing through policy.redact()`,
        );
      }
    }
  }

  return violations;
}

describe("API route redaction guard", () => {
  it("verifies that all fund route handlers in app.ts return data via policy.redact()", () => {
    const appTsPath = path.join(__dirname, "app.ts");
    const appTsContent = fs.readFileSync(appTsPath, "utf-8");

    const violations = scanRouteHandlersForRedaction(appTsContent);
    expect(violations).toEqual([]);
  });

  it("detects and flags violations when a route handler returns fund data without calling redact", () => {
    const badSource = `
      app.openapi(getFundRoute, (c) => {
        const id = parseFundId(c.req.valid("param").fundId);
        const entry = funds.get(id.value);
        return c.json(entry.fund, 200);
      });
    `;

    const violations = scanRouteHandlersForRedaction(badSource);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain(
      "Route getFundRoute returns fund data without passing through policy.redact()",
    );
  });

  it("enforces that Redacted<T> is a distinct branded type from unredacted data", () => {
    // An unbranded FundView must not equal Redacted<FundView> without passing through markRedacted
    expectTypeOf<FundView>().not.toEqualTypeOf<Redacted<FundView>>();

    const unredacted: FundView = {
      id: asFundId("00000000-0000-4000-8000-000000000001"),
      name: "Test Fund",
      targetPaise: "100000",
      createdAt: "2026-10-27T00:00:00.000Z",
    };

    const redacted = markRedacted(unredacted);
    expectTypeOf(redacted).toMatchTypeOf<Redacted<FundView>>();
  });
});
