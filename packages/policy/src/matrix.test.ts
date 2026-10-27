import { describe, expect, expectTypeOf, it } from "vitest";
import { ACTIONS, type Action } from "./actions.js";
import { can } from "./engine.js";
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
    expect(FUND_ROLES.length).toBe(6);
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
  // Generate all 22 actions * 6 roles = 132 test matrix pairs
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

  it("generates exactly 132 test cases (22 actions x 6 roles)", () => {
    expect(matrixEntries.length).toBe(132);
  });

  it.each(matrixEntries)(
    "evaluates role=$role action=$action -> $expected",
    ({ action, role, expected }) => {
      // isActionAllowedForRole checks the lookup table
      expect(isActionAllowedForRole(role, action)).toBe(expected);

      // can() without specific resource context must match base matrix
      const actor = { role };
      expect(can(actor, action)).toBe(expected);
    },
  );
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
