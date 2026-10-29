import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Redacted, unsafeMarkRedactedForDevPolicy } from "@yen/policy";
import { type FundId, parseFundId } from "@yen/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import { devPolicy, type FundView, redactActionReceipt } from "./policy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function asFundId(id: string): FundId {
  const parsed = parseFundId(id);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/**
 * Scans route handler source text to verify that every data-returning branch in any route handler
 * dealing with fund data passes through policy.redact(), a named policy projection, or
 * policy.redactReceipt() (e.g. `deps.policy.redact(...)`, `redactExpenseDetails(...)`, or
 * `redactReceipt(...)`).
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
      routeName.toLowerCase().includes("expense") ||
      routeName.toLowerCase().includes("payee") ||
      routeName.toLowerCase().includes("policy") ||
      routeName.toLowerCase().includes("member") ||
      handlerBody.includes('"/v1/funds') ||
      handlerBody.includes("authorizedFund") ||
      handlerBody.includes("funds.get") ||
      handlerBody.includes("funds.set");

    if (isFundRoute) {
      const redactedVariables = new Set<string>();
      const redactedAssignment =
        /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*\b(?:redactFundReadModel|redactExpenseDetails|redactExpenseProofs|redactExpense|redactReceipt|redact)\s*\(/g;
      let assignmentMatch: RegExpExecArray | null = null;
      while (true) {
        assignmentMatch = redactedAssignment.exec(handlerBody);
        if (assignmentMatch === null) break;
        redactedVariables.add(assignmentMatch[1] ?? "");
      }
      const isRedacted = (argument: string) =>
        argument.includes(".redact(") ||
        argument.includes("redact(") ||
        argument.includes(".redactReceipt(") ||
        argument.includes("redactReceipt(") ||
        argument.includes("redactExpense(") ||
        argument.includes("redactExpenseDetails(") ||
        argument.includes("redactExpenseProofs(") ||
        argument.includes("redactFundReadModel(") ||
        [...redactedVariables].some((name) => new RegExp(`\\b${name}\\b`).test(argument.trim()));
      if (!isBlock) {
        // Expression-bodied handler: e.g. (c) => c.json(entry.fund, 200)
        const cJsonMatch = /c\.json\s*\(([\s\S]*?)\)/.exec(handlerBody);
        if (!cJsonMatch) {
          violations.push(
            `Route ${routeName} returns fund data without passing through policy.redact()`,
          );
        } else {
          const arg = cJsonMatch[1] ?? "";
          if (!isRedacted(arg)) {
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
          if (!isRedacted(returnArg)) {
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

  it("accepts fund read handlers that bind a policy-redacted projection before returning it", () => {
    const source = `
      app.openapi(publicFundSummaryRoute, async (c) => {
        const body = redactFundReadModel(actor, source);
        setFundReadCache(c, publicTier, body);
        return c.json(body, 200);
      });
    `;
    expect(scanRouteHandlersForRedaction(source)).toEqual([]);
  });

  it("requires policy redaction on public expense details and proof responses", () => {
    const rawRoutes = `
      app.openapi(publicExpenseDetailRoute, async (c) => {
        const expense = await deps.expenseStore.get(c.req.valid("param").expenseId);
        return c.json(expense, 200);
      });
      app.openapi(publicExpenseProofsRoute, async (c) => {
        const proofs = await deps.evidenceStore.getByExpense(fundId, expenseId);
        return c.json({ proofs }, 200);
      });
    `;
    expect(scanRouteHandlersForRedaction(rawRoutes)).toHaveLength(2);

    const redactedRoutes = `
      app.openapi(publicExpenseDetailRoute, async (c) => {
        const body = redactExpenseDetails(actor, expense);
        return c.json(body, 200);
      });
      app.openapi(publicExpenseProofsRoute, async (c) => {
        const body = redactExpenseProofs(actor, proofs);
        return c.json(body, 200);
      });
    `;
    expect(scanRouteHandlersForRedaction(redactedRoutes)).toEqual([]);
  });

  it("detects and flags violations when an action route handler returns raw fund data directly", () => {
    const badActionSource = `
      app.openapi(approveExpenseRoute, async (c) => {
        const { fundId } = c.req.valid("param");
        const entry = funds.get(fundId);
        return c.json(entry.fund, 200);
      });
    `;

    const violations = scanRouteHandlersForRedaction(badActionSource);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain(
      "Route approveExpenseRoute returns fund data without passing through policy.redact()",
    );
  });

  it("detects and flags violations in an action route handler with one raw return branch and one redacted receipt", () => {
    const mixedActionSource = `
      app.openapi(approveExpenseRoute, async (c) => {
        const { fundId, expenseId } = c.req.valid("param");
        const { id, resource } = getFundOrNotFound(fundId);
        if (c.req.header("x-legacy")) {
          return c.json(resource.fund, 200);
        }
        return c.json(
          deps.policy.redactReceipt(
            principal,
            "fund:expense:approve",
            { status: "approved" as const, expenseId, approvedAt: "2026-10-28T00:00:00.000Z" },
            resource,
          ),
          200,
        );
      });
    `;

    const violations = scanRouteHandlersForRedaction(mixedActionSource);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain(
      "Route approveExpenseRoute returns fund data without passing through policy.redact() (1 unredacted of 2 branches)",
    );
  });

  it("detects and flags violations in an expression-bodied raw action route", () => {
    const exprActionSource = `
      app.openapi(approveExpenseRoute, (c) => c.json(resource.fund, 200));
    `;

    const violations = scanRouteHandlersForRedaction(exprActionSource);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain(
      "Route approveExpenseRoute returns fund data without passing through policy.redact()",
    );
  });

  it("accepts an action route handler that passes through redactReceipt", () => {
    const validActionSource = `
      app.openapi(approveExpenseRoute, async (c) => {
        return c.json(
          deps.policy.redactReceipt(
            principal,
            "fund:expense:approve",
            { status: "approved" as const, expenseId: "uuid", approvedAt: "2026-10-28T00:00:00.000Z" },
            resource,
          ),
          200,
        );
      });
    `;

    const violations = scanRouteHandlersForRedaction(validActionSource);
    expect(violations).toEqual([]);
  });

  it("enforces that action receipts cannot leak extra fields or sensitive data across the boundary", () => {
    const rawWithExtra = {
      status: "approved" as const,
      expenseId: "00000000-0000-4000-8000-000000000001",
      approvedAt: "2026-10-28T00:00:00.000Z",
      secretInternalPin: "123456",
      fundBalancePaise: "999999999",
      donorPii: { name: "Alice", phone: "+919999999999" },
    };

    const redacted = redactActionReceipt("fund:expense:approve", rawWithExtra);
    expect(redacted).toEqual({
      status: "approved",
      expenseId: "00000000-0000-4000-8000-000000000001",
      approvedAt: "2026-10-28T00:00:00.000Z",
    });
    expect(redacted).not.toHaveProperty("secretInternalPin");
    expect(redacted).not.toHaveProperty("fundBalancePaise");
    expect(redacted).not.toHaveProperty("donorPii");
    expect(Object.keys(redacted).sort()).toEqual(["approvedAt", "expenseId", "status"].sort());
  });

  it("enforces that all 6 action receipt types strip extra fields and validate required shapes", () => {
    // 1. approve
    const approve = redactActionReceipt("fund:expense:approve", {
      status: "approved",
      expenseId: "00000000-0000-4000-8000-000000000001",
      approvedAt: "2026-10-28T00:00:00.000Z",
      leak: "bad",
    });
    expect(approve).not.toHaveProperty("leak");
    expect(Object.keys(approve).sort()).toEqual(["approvedAt", "expenseId", "status"].sort());

    // 2. reject
    const reject = redactActionReceipt("fund:expense:reject", {
      status: "rejected",
      expenseId: "00000000-0000-4000-8000-000000000001",
      reason: "policy",
      rejectedAt: "2026-10-28T00:00:00.000Z",
      leak: "bad",
    });
    expect(reject).not.toHaveProperty("leak");
    expect(Object.keys(reject).sort()).toEqual(
      ["expenseId", "reason", "rejectedAt", "status"].sort(),
    );

    // 3. payee change
    const payee = redactActionReceipt("fund:payee:change", {
      status: "updated",
      vpa: "test@upi",
      leak: "bad",
    });
    expect(payee).not.toHaveProperty("leak");
    expect(Object.keys(payee).sort()).toEqual(["status", "vpa"].sort());

    // 4. policy change
    const pol = redactActionReceipt("fund:policy:change", {
      status: "updated",
      policyJson: { quorum: 2 },
      leak: "bad",
    });
    expect(pol).not.toHaveProperty("leak");
    expect(Object.keys(pol).sort()).toEqual(["policyJson", "status"].sort());

    // 5. add member
    const addMem = redactActionReceipt("fund:member:add", {
      status: "added",
      memberId: "00000000-0000-4000-8000-000000000002",
      role: "approver",
      leak: "bad",
    });
    expect(addMem).not.toHaveProperty("leak");
    expect(Object.keys(addMem).sort()).toEqual(["memberId", "role", "status"].sort());

    // 6. remove member
    const remMem = redactActionReceipt("fund:member:remove", {
      status: "removed",
      memberId: "00000000-0000-4000-8000-000000000002",
      leak: "bad",
    });
    expect(remMem).not.toHaveProperty("leak");
    expect(Object.keys(remMem).sort()).toEqual(["memberId", "status"].sort());
  });

  it("rejects raw fund returns or malformed shapes when passed to redactActionReceipt", () => {
    const rawFund = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Secret Club Fund",
      targetPaise: "100000",
      createdAt: "2026-10-28T00:00:00.000Z",
    };

    expect(() => redactActionReceipt("fund:expense:approve", rawFund)).toThrow(
      "Invalid expense approval receipt: shape mismatch",
    );
    expect(() => redactActionReceipt("fund:expense:reject", rawFund)).toThrow(
      "Invalid expense rejection receipt: shape mismatch",
    );
    expect(() => redactActionReceipt("fund:payee:change", rawFund)).toThrow(
      "Invalid payee change receipt: shape mismatch",
    );
    expect(() => redactActionReceipt("fund:policy:change", rawFund)).toThrow(
      "Invalid policy change receipt: shape mismatch",
    );
    expect(() => redactActionReceipt("fund:member:add", rawFund)).toThrow(
      "Invalid member add receipt: shape mismatch",
    );
    expect(() => redactActionReceipt("fund:member:remove", rawFund)).toThrow(
      "Invalid member remove receipt: shape mismatch",
    );
  });

  it("enforces proper permissions in devPolicy.redactReceipt", () => {
    const owner = { id: "00000000-0000-4000-8000-000000000001" };
    const stranger = { id: "00000000-0000-4000-8000-000000000099" };
    const fundResource = {
      kind: "fund" as const,
      fund: {
        owner: owner.id,
        fund: {
          id: asFundId("00000000-0000-4000-8000-000000000001"),
          name: "Owner Fund",
          targetPaise: "100000",
          upiVpa: "owner@yenbank",
          upiPayeeName: "Owner Fund",
          createdAt: "2026-10-28T00:00:00.000Z",
          visibility: "private" as const,
        },
      },
    };

    const receipt = {
      status: "approved" as const,
      expenseId: "00000000-0000-4000-8000-000000000002",
      approvedAt: "2026-10-28T00:00:00.000Z",
    };

    // Owner succeeds
    const result = devPolicy.redactReceipt?.(owner, "fund:expense:approve", receipt, fundResource);
    expect(result).toEqual(receipt);

    // Stranger fails permission check
    expect(() =>
      devPolicy.redactReceipt?.(stranger, "fund:expense:approve", receipt, fundResource),
    ).toThrow("Forbidden");
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
      visibility: "private",
    };

    const redacted = unsafeMarkRedactedForDevPolicy(unredacted);
    expectTypeOf(redacted).toMatchTypeOf<Redacted<FundView>>();
  });
});
