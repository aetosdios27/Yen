import { describe, expect, expectTypeOf, it } from "vitest";
import { ACTIONS, type Action } from "./actions.js";
import { roleMayPerform } from "./engine.js";
import { isActionAllowedForRole, ROLE_ACTION_MATRIX, type RoleActionMatrix } from "./matrix.js";
import { FUND_ROLES, type FundRole } from "./roles.js";

describe("Role x Action Matrix completeness", () => {
  it("covers every declared action in ACTIONS", () => {
    expect(ACTIONS.length).toBe(22);
    for (const action of ACTIONS) {
      expect(ROLE_ACTION_MATRIX).toHaveProperty(action);
    }
  });

  it("covers every declared role in FUND_ROLES for every action", () => {
    expect(FUND_ROLES.length).toBe(7);
    for (const action of ACTIONS) {
      for (const role of FUND_ROLES) {
        const allowed = ROLE_ACTION_MATRIX[action][role];
        expect(typeof allowed).toBe("boolean");
      }
    }
  });

  it("enforces type-level exhaustiveness", () => {
    expectTypeOf<RoleActionMatrix>().toEqualTypeOf<{
      readonly [A in Action]: {
        readonly [R in FundRole]: boolean;
      };
    }>();
  });
});

describe("Table-driven role x action permission tests", () => {
  // Generate all 22 actions * 7 roles = 154 test matrix pairs
  const matrixEntries: Array<{ action: Action; role: FundRole; expected: boolean }> = [];
  for (const action of ACTIONS) {
    for (const role of FUND_ROLES) {
      matrixEntries.push({
        action,
        role,
        expected: ROLE_ACTION_MATRIX[action][role],
      });
    }
  }

  it("generates exactly 154 test cases (22 actions x 7 roles)", () => {
    expect(matrixEntries.length).toBe(154);
  });

  it.each(matrixEntries)(
    "evaluates role=$role action=$action -> $expected",
    ({ action, role, expected }) => {
      // isActionAllowedForRole checks the lookup table
      expect(isActionAllowedForRole(role, action)).toBe(expected);

      expect(roleMayPerform({ role }, action)).toBe(expected);
    },
  );
});

describe("Prototype pollution and unknown role defense (R10)", () => {
  it("denies access for runtime roles from Object prototype (e.g. toString, constructor)", () => {
    expect(isActionAllowedForRole("toString" as FundRole, "bank:reconcile")).toBe(false);
    expect(isActionAllowedForRole("constructor" as FundRole, "fund:read")).toBe(false);
    expect(isActionAllowedForRole("valueOf" as FundRole, "expense:approve")).toBe(false);
    expect(isActionAllowedForRole("owner", "toString" as Action)).toBe(false);

    expect(roleMayPerform({ role: "toString" as FundRole }, "bank:reconcile")).toBe(false);
    expect(
      roleMayPerform(
        { role: "public", roles: ["toString" as unknown as FundRole] },
        "bank:reconcile",
      ),
    ).toBe(false);
  });
});

describe("Matrix Markdown documentation generator / verifier", () => {
  it("produces a valid markdown table representing the role x action matrix", () => {
    const header = `| Action | ${FUND_ROLES.join(" | ")} |`;
    const separator = `| :--- | ${FUND_ROLES.map(() => ":---:").join(" | ")} |`;
    const rows = ACTIONS.map((action) => {
      const cells = FUND_ROLES.map((role) => (ROLE_ACTION_MATRIX[action][role] ? "ALLOW" : "DENY"));
      return `| \`${action}\` | ${cells.join(" | ")} |`;
    });
    const markdown = [header, separator, ...rows].join("\n");
    expect(markdown).toContain("| `expense:submit` | ALLOW | ALLOW | DENY | DENY | DENY | DENY |");
    expect(markdown).toContain(
      "| `fund:update_policy` | ALLOW | DENY | DENY | DENY | DENY | DENY |",
    );
  });
});
