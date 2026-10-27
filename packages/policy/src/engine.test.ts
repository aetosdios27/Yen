import { type FundId, type PseudonymId, paise, parseFundId, parsePseudonymId } from "@yen/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Action } from "./actions.js";
import { can, isExpenseFullyApproved } from "./engine.js";
import { DEFAULT_FUND_POLICY, type FundPolicy, requiredQuorumForExpense } from "./policy.js";
import type { Resource } from "./resources.js";
import type { Actor } from "./roles.js";

function asFundId(id: string): FundId {
  const parsed = parseFundId(id);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function asPseudonymId(id: string): PseudonymId {
  const parsed = parsePseudonymId(id);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const requesterId = asPseudonymId("psn_00000000-0000-0000-0000-000000000001");
const approver1Id = asPseudonymId("psn_00000000-0000-0000-0000-000000000002");
const approver2Id = asPseudonymId("psn_00000000-0000-0000-0000-000000000003");
const treasurerId = asPseudonymId("psn_00000000-0000-0000-0000-000000000004");
const ownerId = asPseudonymId("psn_00000000-0000-0000-0000-000000000005");
const fundId = asFundId("00000000-0000-4000-8000-000000000099");

describe("Separation of duties: expense approval", () => {
  const baseExpenseResource: Resource = {
    kind: "expense",
    expense: {
      fundId,
      expenseId: "exp-1",
      requesterId,
      amountPaise: paise(5000), // 50 INR
      policy: {
        ...DEFAULT_FUND_POLICY,
        approvalQuorum: 2,
      },
    },
  };

  it("denies a payout unless the approvals on record satisfy the policy", () => {
    const treasurer: Actor = { id: treasurerId, role: "treasurer" };
    const submitted = (approvals: readonly { approverId: string; roleAtApproval: "approver" }[]) =>
      ({
        kind: "expense",
        expense: { ...baseExpenseResource.expense, status: "submitted", approvals },
      }) as const satisfies Resource;
    expect(can(treasurer, "expense:payout", baseExpenseResource)).toBe(false);
    expect(can(treasurer, "expense:payout", submitted([]))).toBe(false);
    expect(
      can(
        treasurer,
        "expense:payout",
        submitted([{ approverId: approver1Id, roleAtApproval: "approver" }]),
      ),
    ).toBe(false);
    expect(
      can(
        treasurer,
        "expense:payout",
        submitted([
          { approverId: approver1Id, roleAtApproval: "approver" },
          { approverId: approver2Id, roleAtApproval: "approver" },
        ]),
      ),
    ).toBe(true);
  });

  it("denies approval when the actor has no id, because self-approval cannot be ruled out", () => {
    const anonymousApprover: Actor = { role: "approver" };
    expect(can(anonymousApprover, "expense:approve", baseExpenseResource)).toBe(false);
    const anonymousOwner: Actor = { role: "owner" };
    expect(can(anonymousOwner, "expense:approve", baseExpenseResource)).toBe(false);
  });

  it("denies membership changes when the actor has no id", () => {
    const resource: Resource = {
      kind: "member",
      member: { fundId, memberId: approver1Id, targetRole: "approver" },
    };
    expect(can({ role: "owner" }, "fund:add_member", resource)).toBe(false);
    expect(can({ id: ownerId, role: "owner" }, "fund:add_member", resource)).toBe(true);
  });

  it("requires a resource, so a role grant alone cannot authorise a resource-bound action", () => {
    expectTypeOf(can).parameters.toEqualTypeOf<[Actor, Action, Resource]>();
  });

  it("denies approval when the approver is the requester (Rule 1: no self-approval)", () => {
    // Requester has 'approver' role
    const actor: Actor = { id: requesterId, role: "approver" };
    expect(can(actor, "expense:approve", baseExpenseResource)).toBe(false);

    // Requester has 'owner' role
    const ownerActor: Actor = { id: requesterId, role: "owner" };
    expect(can(ownerActor, "expense:approve", baseExpenseResource)).toBe(false);
  });

  it("permits approval by an approver who is NOT the requester", () => {
    const actor: Actor = { id: approver1Id, role: "approver" };
    expect(can(actor, "expense:approve", baseExpenseResource)).toBe(true);

    const ownerActor: Actor = { id: ownerId, role: "owner" };
    expect(can(ownerActor, "expense:approve", baseExpenseResource)).toBe(true);
  });

  it("denies approval when actor has only the treasurer role", () => {
    const actor: Actor = { id: treasurerId, role: "treasurer" };
    expect(can(actor, "expense:approve", baseExpenseResource)).toBe(false);
  });

  it("denies approval when treasurer would be the sole approver (Rule 2: treasurer cannot be sole approver)", () => {
    const quorum1Resource: Resource = {
      kind: "expense",
      expense: {
        fundId,
        expenseId: "exp-1",
        requesterId,
        amountPaise: paise(5000),
        policy: {
          ...DEFAULT_FUND_POLICY,
          approvalQuorum: 1, // quorum of 1
        },
      },
    };

    // Actor holds both treasurer and approver roles
    const dualRoleTreasurer: Actor = {
      id: treasurerId,
      role: "treasurer",
      roles: ["treasurer", "approver"],
    };

    // If quorum is 1, treasurer cannot approve alone
    expect(can(dualRoleTreasurer, "expense:approve", quorum1Resource)).toBe(false);
  });

  it("prevents duplicate approvals by the same actor", () => {
    const resourceWithApproval: Resource = {
      kind: "expense",
      expense: {
        fundId,
        expenseId: "exp-1",
        requesterId,
        amountPaise: paise(5000),
        policy: { ...DEFAULT_FUND_POLICY, approvalQuorum: 2 },
        approvals: [{ approverId: approver1Id, roleAtApproval: "approver" }],
      },
    };

    const approver1: Actor = { id: approver1Id, role: "approver" };
    expect(can(approver1, "expense:approve", resourceWithApproval)).toBe(false);

    const approver2: Actor = { id: approver2Id, role: "approver" };
    expect(can(approver2, "expense:approve", resourceWithApproval)).toBe(true);
  });
});

describe("isExpenseFullyApproved predicate", () => {
  const policy: FundPolicy = {
    ...DEFAULT_FUND_POLICY,
    approvalQuorum: 2,
  };
  const amount = paise(10000);

  it("returns false if fewer approvals than required quorum", () => {
    const approvals = [{ approverId: approver1Id, roleAtApproval: "approver" as const }];
    expect(isExpenseFullyApproved(approvals, policy, amount, requesterId)).toBe(false);
  });

  it("returns false if requester is among the approvals and remaining distinct valid approvals < quorum", () => {
    const approvals = [
      { approverId: requesterId, roleAtApproval: "approver" as const },
      { approverId: approver1Id, roleAtApproval: "approver" as const },
    ];
    expect(isExpenseFullyApproved(approvals, policy, amount, requesterId)).toBe(false);
  });

  it("returns false if all approvers are treasurers", () => {
    const approvals = [
      { approverId: treasurerId, roleAtApproval: "treasurer" as const },
      {
        approverId: asPseudonymId("psn_00000000-0000-0000-0000-000000000009"),
        roleAtApproval: "treasurer" as const,
      },
    ];
    expect(isExpenseFullyApproved(approvals, policy, amount, requesterId)).toBe(false);
  });

  it("returns true when required quorum is met with distinct non-requester approvers including a non-treasurer", () => {
    const approvals = [
      { approverId: approver1Id, roleAtApproval: "approver" as const },
      { approverId: approver2Id, roleAtApproval: "approver" as const },
    ];
    expect(isExpenseFullyApproved(approvals, policy, amount, requesterId)).toBe(true);
  });

  it("deduplicates approvals from the same actor", () => {
    const approvals = [
      { approverId: approver1Id, roleAtApproval: "approver" as const },
      { approverId: approver1Id, roleAtApproval: "approver" as const },
    ];
    expect(isExpenseFullyApproved(approvals, policy, amount, requesterId)).toBe(false);
  });
});

describe("Spend thresholds and tiered quorums", () => {
  const policyWithThresholds: FundPolicy = {
    visibilityTier: "members",
    approvalQuorum: 2, // base quorum
    spendThresholds: [
      { minAmountPaise: paise(5000000), requiredQuorum: 3 }, // >= 50,000 INR
      { minAmountPaise: paise(20000000), requiredQuorum: 4 }, // >= 200,000 INR
    ],
  };

  it("uses base quorum for amounts below first threshold", () => {
    expect(requiredQuorumForExpense(policyWithThresholds, paise(100000))).toBe(2);
  });

  it("requires higher quorum for amounts meeting first threshold", () => {
    expect(requiredQuorumForExpense(policyWithThresholds, paise(5000000))).toBe(3);
    expect(requiredQuorumForExpense(policyWithThresholds, paise(10000000))).toBe(3);
  });

  it("requires highest quorum for amounts meeting second threshold", () => {
    expect(requiredQuorumForExpense(policyWithThresholds, paise(25000000))).toBe(4);
  });
});

describe("Visibility tiers", () => {
  const makeFundResource = (
    visibilityTier: "public" | "donors" | "members" | "private",
  ): Resource => ({
    kind: "fund",
    fund: {
      fundId,
      policy: { ...DEFAULT_FUND_POLICY, visibilityTier },
    },
  });

  it("public tier: accessible to public, donor, member, owner", () => {
    const res = makeFundResource("public");
    expect(can({ role: "public" }, "fund:read", res)).toBe(true);
    expect(can({ role: "donor" }, "fund:read", res)).toBe(true);
    expect(can({ role: "approver" }, "fund:read", res)).toBe(true);
    expect(can({ role: "owner" }, "fund:read", res)).toBe(true);
  });

  it("donors tier: accessible to donors and staff, denied to general public", () => {
    const res = makeFundResource("donors");
    expect(can({ role: "public" }, "fund:read", res)).toBe(false);
    expect(can({ role: "donor" }, "fund:read", res)).toBe(true);
    expect(can({ role: "approver" }, "fund:read", res)).toBe(true);
    expect(can({ role: "owner" }, "fund:read", res)).toBe(true);
  });

  it("members tier: accessible to staff/members, denied to public and donors", () => {
    const res = makeFundResource("members");
    expect(can({ role: "public" }, "fund:read", res)).toBe(false);
    expect(can({ role: "donor" }, "fund:read", res)).toBe(false);
    expect(can({ role: "approver" }, "fund:read", res)).toBe(true);
    expect(can({ role: "treasurer" }, "fund:read", res)).toBe(true);
    expect(can({ role: "owner" }, "fund:read", res)).toBe(true);
  });

  it("private tier: accessible only to staff", () => {
    const res = makeFundResource("private");
    expect(can({ role: "public" }, "fund:read", res)).toBe(false);
    expect(can({ role: "donor" }, "fund:read", res)).toBe(false);
    expect(can({ role: "approver" }, "fund:read", res)).toBe(true);
    expect(can({ role: "treasurer" }, "fund:read", res)).toBe(true);
    expect(can({ role: "owner" }, "fund:read", res)).toBe(true);
  });
});

describe("Evidence tamper resistance (Threat E4)", () => {
  it("allows adding evidence while expense is submitted", () => {
    const res: Resource = {
      kind: "expense",
      expense: {
        fundId,
        requesterId,
        amountPaise: paise(1000),
        policy: DEFAULT_FUND_POLICY,
        status: "submitted",
      },
    };
    expect(can({ role: "treasurer" }, "expense:add_evidence", res)).toBe(true);
  });

  it("denies adding evidence once expense is approved or paid", () => {
    const approvedRes: Resource = {
      kind: "expense",
      expense: {
        fundId,
        requesterId,
        amountPaise: paise(1000),
        policy: DEFAULT_FUND_POLICY,
        status: "approved",
      },
    };
    expect(can({ role: "treasurer" }, "expense:add_evidence", approvedRes)).toBe(false);

    const paidRes: Resource = {
      kind: "expense",
      expense: {
        fundId,
        requesterId,
        amountPaise: paise(1000),
        policy: DEFAULT_FUND_POLICY,
        status: "paid",
      },
    };
    expect(can({ role: "treasurer" }, "expense:add_evidence", paidRes)).toBe(false);
  });
});

describe("Objection window", () => {
  it("allows raising objections when window is open", () => {
    const res: Resource = {
      kind: "expense",
      expense: {
        fundId,
        requesterId,
        amountPaise: paise(1000),
        policy: DEFAULT_FUND_POLICY,
        objectionWindowOpen: true,
      },
    };
    expect(can({ role: "donor" }, "expense:raise_objection", res)).toBe(true);
  });

  it("denies raising objections when window is closed", () => {
    const res: Resource = {
      kind: "expense",
      expense: {
        fundId,
        requesterId,
        amountPaise: paise(1000),
        policy: DEFAULT_FUND_POLICY,
        objectionWindowOpen: false,
      },
    };
    expect(can({ role: "donor" }, "expense:raise_objection", res)).toBe(false);
  });
});

describe("Member management (Threat X4)", () => {
  it("only owner can add or remove members", () => {
    const res: Resource = {
      kind: "member",
      member: {
        fundId,
        memberId: asPseudonymId("psn_00000000-0000-0000-0000-000000000077"),
        targetRole: "approver",
      },
    };

    expect(can({ id: ownerId, role: "owner" }, "fund:add_member", res)).toBe(true);
    expect(can({ role: "treasurer" }, "fund:add_member", res)).toBe(false);
    expect(can({ role: "approver" }, "fund:add_member", res)).toBe(false);
    expect(can({ role: "donor" }, "fund:add_member", res)).toBe(false);
    expect(can({ role: "public" }, "fund:add_member", res)).toBe(false);
  });

  it("prevents self-modification of membership", () => {
    const targetId = asPseudonymId("psn_00000000-0000-0000-0000-000000000088");
    const res: Resource = {
      kind: "member",
      member: {
        fundId,
        memberId: targetId,
        targetRole: "owner",
      },
    };
    expect(can({ id: targetId, role: "owner" }, "fund:add_member", res)).toBe(false);
  });
});
