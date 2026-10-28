import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Redacted, unsafeMarkRedactedForDevPolicy } from "@yen/policy";
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
 * Scans route handler source text to verify that every data-returning branch in any route handler
 * dealing with fund data passes through policy.redact() (e.g. `deps.policy.redact(...)` or `redact(...)`).
 *
 * NOTE: This is a static tripwire designed to catch unredacted leak paths (such as raw return branches
 * or expression-bodied raw returns) during development and CI. It is a tripwire, not a formal proof.
 */
function scanRouteHandlersForRedaction(sourceText: string): string[] {
  const violations: string[] = [];

  // Match app.openapi(routeIdentifier, (c) => ...)
  // Followed either by { (block body) or an expression
  const routeRegex =
    /app\.openapi\s*\(\s*([a-zA-Z0-9_]+)\s*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*([{\s\S])/g;
  let match: RegExpExecArray | null = null;

  while (true) {
    match = routeRegex.exec(sourceText);
    if (match === null) break;

    const routeName = match[1] ?? "";
    const firstBodyChar = match[2] ?? "";
    const isBlock = firstBodyChar === "{";

    let handlerBody = "";
    if (isBlock) {
      const startIndex = match.index + match[0].length - 1; // index of "{"
      let braceDepth = 1;
      let endIndex = startIndex + 1;
      while (endIndex < sourceText.length && braceDepth > 0) {
        const ch = sourceText[endIndex];
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        endIndex++;
      }
      handlerBody = sourceText.slice(startIndex, endIndex);
    } else {
      // Expression body: read until closing ");" of app.openapi(...)
      const startIndex = match.index + match[0].length - 1;
      let parenDepth = 1;
      let endIndex = startIndex;
      while (endIndex < sourceText.length && parenDepth > 0) {
        const ch = sourceText[endIndex];
        if (ch === "(") parenDepth++;
        else if (ch === ")") parenDepth--;
        endIndex++;
      }
      handlerBody = sourceText.slice(startIndex, endIndex - 1).trim();
    }

    // Identify if route touches fund data
    const isFundRoute =
      routeName.toLowerCase().includes("fund") ||
      handlerBody.includes('"/v1/funds') ||
      handlerBody.includes("authorizedFund") ||
      handlerBody.includes("funds.get") ||
      handlerBody.includes("funds.set");

    if (isFundRoute) {
      if (!isBlock) {
        // Expression-bodied handler: e.g. (c) => c.json(entry.fund, 200)
        const cJsonMatch = /c\.json\s*\(([\s\S]*?)\)/.exec(handlerBody);
        if (!cJsonMatch) {
          violations.push(
            `Route ${routeName} returns fund data without passing through policy.redact()`,
          );
        } else {
          const arg = cJsonMatch[1] ?? "";
          if (!arg.includes(".redact(") && !arg.includes("redact(")) {
            violations.push(
              `Route ${routeName} returns fund data without passing through policy.redact()`,
            );
          }
        }
      } else {
        // Block-bodied handler: check ALL return c.json(...) statements across every branch
        const returnJsonRegex = /return\s+c\.json\s*\(([\s\S]*?)\);/g;
        let returnMatch: RegExpExecArray | null = null;
        let totalReturns = 0;
        let unredactedReturns = 0;

        while (true) {
          returnMatch = returnJsonRegex.exec(handlerBody);
          if (returnMatch === null) break;
          totalReturns++;
          const returnArg = returnMatch[1] ?? "";
          if (!returnArg.includes(".redact(") && !returnArg.includes("redact(")) {
            unredactedReturns++;
          }
        }

        if (totalReturns === 0 || unredactedReturns > 0) {
          violations.push(
            `Route ${routeName} returns fund data without passing through policy.redact() (${unredactedReturns} unredacted of ${totalReturns} branch${totalReturns === 1 ? "" : "es"})`,
          );
        }
      }
    }
  }

  return violations;
}

describe("API route redaction guard (tripwire)", () => {
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

  it("detects and flags violations in a handler with one raw return and one redacted return (branch bypass)", () => {
    const dualBranchBypassSource = `
      app.openapi(getFundRoute, (c) => {
        const id = parseFundId(c.req.valid("param").fundId);
        const entry = funds.get(id.value);
        if (entry.isPublic) {
          return c.json(deps.policy.redact(principal, resource), 200);
        }
        return c.json(entry.fund, 200);
      });
    `;

    const violations = scanRouteHandlersForRedaction(dualBranchBypassSource);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain(
      "Route getFundRoute returns fund data without passing through policy.redact() (1 unredacted of 2 branches)",
    );
  });

  it("detects and flags violations in an expression-bodied raw handler", () => {
    const exprBypassSource = `
      app.openapi(getFundRoute, (c) => c.json(entry.fund, 200));
    `;

    const violations = scanRouteHandlersForRedaction(exprBypassSource);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain(
      "Route getFundRoute returns fund data without passing through policy.redact()",
    );
  });

  it("accepts an expression-bodied handler that passes through redact", () => {
    const exprRedactedSource = `
      app.openapi(getFundRoute, (c) => c.json(deps.policy.redact(principal, resource), 200));
    `;

    const violations = scanRouteHandlersForRedaction(exprRedactedSource);
    expect(violations).toEqual([]);
  });

  it("enforces that Redacted<T> is a distinct branded type from unredacted data", () => {
    // An unbranded FundView must not equal Redacted<FundView> without passing through unsafeMarkRedactedForDevPolicy
    expectTypeOf<FundView>().not.toEqualTypeOf<Redacted<FundView>>();

    const unredacted: FundView = {
      id: asFundId("00000000-0000-4000-8000-000000000001"),
      name: "Test Fund",
      targetPaise: "100000",
      upiVpa: "test@yenbank",
      upiPayeeName: "Test Payee",
      createdAt: "2026-10-27T00:00:00.000Z",
    };

    const redacted = unsafeMarkRedactedForDevPolicy(unredacted);
    expectTypeOf(redacted).toMatchTypeOf<Redacted<FundView>>();
  });
});
