import { type FundId, type PseudonymId, paise, parseFundId, parsePseudonymId } from "@yen/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Action } from "./actions.js";
import { can, isExpenseFullyApproved } from "./engine.js";
import { DEFAULT_FUND_POLICY, type FundPolicy, requiredQuorumForExpense } from "./policy.js";
import type { Resource } from "./resources.js";
import type { Actor, FundRole } from "./roles.js";

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
      status: "submitted",
      approvals: [],
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
        status: "submitted",
        approvals: [],
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
        status: "submitted",
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
  it("allows adding evidence while expense is submitted and short of quorum", () => {
    const res: Resource = {
      kind: "expense",
      expense: {
        fundId,
        requesterId,
        amountPaise: paise(1000),
        policy: DEFAULT_FUND_POLICY,
        status: "submitted",
        approvals: [],
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

const treasurerApprover: Actor = {
  id: treasurerId,
  role: "treasurer",
  roles: ["treasurer", "approver"],
};

/** A 50 INR expense with the given approvals, quorum (default 2) and status (default submitted). */
function expenseWith(
  approvals: unknown,
  overrides: Partial<FundPolicy> = {},
  status: unknown = "submitted",
): Resource {
  return {
    kind: "expense",
    expense: {
      fundId,
      expenseId: "exp-1",
      requesterId,
      amountPaise: paise(5000),
      status: status as "submitted",
      approvals: approvals as never,
      policy: { ...DEFAULT_FUND_POLICY, approvalQuorum: 2, ...overrides },
    },
  };
}

const twoApprovers = [
  { approverId: approver1Id, roleAtApproval: "approver" as const },
  { approverId: approver2Id, roleAtApproval: "approver" as const },
];

describe("Resource kind binding (R1)", () => {
  it("denies an owner approving against a fund resource, so no expense check is skipped", () => {
    expect(can({ id: ownerId, role: "owner" }, "expense:approve", { kind: "fund" })).toBe(false);
    expect(can({ id: ownerId, role: "owner" }, "expense:payout", { kind: "fund" })).toBe(false);
  });

  it("denies an expense action against a donation or member resource", () => {
    expect(
      can({ id: approver1Id, role: "approver" }, "expense:approve", {
        kind: "donation",
        donation: { fundId, policy: DEFAULT_FUND_POLICY },
      }),
    ).toBe(false);
  });

  it("denies public fund:read on a fund resource with no fund data", () => {
    expect(can({ role: "public" }, "fund:read", { kind: "fund" })).toBe(false);
    expect(can({ id: ownerId, role: "owner" }, "fund:read", { kind: "fund" })).toBe(false);
  });

  it("allows an absent fund only for fund:create", () => {
    expect(can({ id: ownerId, role: "owner" }, "fund:create", { kind: "fund" })).toBe(true);
    expect(can({ id: ownerId, role: "owner" }, "fund:update_policy", { kind: "fund" })).toBe(false);
  });

  it("denies a fund resource whose policy is malformed", () => {
    const badPolicy = {
      kind: "fund",
      fund: { policy: { ...DEFAULT_FUND_POLICY, visibilityTier: "everyone" } },
    } as unknown as Resource;
    expect(can({ role: "public" }, "fund:read", badPolicy)).toBe(false);
  });
});

describe("Payout states and approval records (R2)", () => {
  it("denies payout of an approved expense that has no recorded approvals", () => {
    expect(can(treasurerApprover, "expense:payout", expenseWith([], {}, "approved"))).toBe(false);
  });

  it("denies payout of paid and rejected expenses even when they retain enough approvals", () => {
    expect(can(treasurerApprover, "expense:payout", expenseWith(twoApprovers, {}, "paid"))).toBe(
      false,
    );
    expect(
      can(treasurerApprover, "expense:payout", expenseWith(twoApprovers, {}, "rejected")),
    ).toBe(false);
  });

  it("allows payout of an approved expense whose recorded approvals meet the policy", () => {
    expect(
      can(treasurerApprover, "expense:payout", expenseWith(twoApprovers, {}, "approved")),
    ).toBe(true);
  });

  it("denies payout when the quorum was raised above the recorded approvals", () => {
    expect(
      can(
        treasurerApprover,
        "expense:payout",
        expenseWith(twoApprovers, { approvalQuorum: 3 }, "approved"),
      ),
    ).toBe(false);
  });

  it("denies payout when the status is missing or unknown", () => {
    const missingStatus: Resource = {
      kind: "expense",
      expense: {
        fundId,
        requesterId,
        amountPaise: paise(5000),
        approvals: twoApprovers,
        policy: { ...DEFAULT_FUND_POLICY, approvalQuorum: 2 },
      },
    };
    expect(can(treasurerApprover, "expense:payout", missingStatus)).toBe(false);
    expect(can(treasurerApprover, "expense:payout", expenseWith(twoApprovers, {}, "bogus"))).toBe(
      false,
    );
  });

  it("denies payout when the approval state is missing or malformed", () => {
    const missing: Resource = {
      kind: "expense",
      expense: {
        fundId,
        requesterId,
        amountPaise: paise(5000),
        status: "approved",
        policy: { ...DEFAULT_FUND_POLICY, approvalQuorum: 2 },
      },
    };
    expect(can(treasurerApprover, "expense:payout", missing)).toBe(false);
    expect(can(treasurerApprover, "expense:payout", expenseWith("two", {}, "approved"))).toBe(
      false,
    );
  });

  it("denies approval of an expense that is already paid or rejected", () => {
    const approver: Actor = { id: approver2Id, role: "approver" };
    expect(can(approver, "expense:approve", expenseWith([], {}, "paid"))).toBe(false);
    expect(can(approver, "expense:approve", expenseWith([], {}, "rejected"))).toBe(false);
  });
});

describe("Approval eligibility (R4)", () => {
  it.each([
    { roleAtApproval: "bogus", rolesAtApproval: ["approver"] },
    { roleAtApproval: "approver", rolesAtApproval: ["bogus"] },
    { roleAtApproval: "approver", rolesAtApproval: "approver" },
  ])("does not count malformed approval roles toward payout: %j", (roles) => {
    const approvals = [
      { approverId: approver1Id, roleAtApproval: "approver" },
      { approverId: approver2Id, ...roles },
    ];
    expect(can(treasurerApprover, "expense:payout", expenseWith(approvals, {}, "approved"))).toBe(
      false,
    );
  });

  const donorApproval = { approverId: approver1Id, roleAtApproval: "donor" as const };
  const publicApproval = { approverId: approver2Id, roleAtApproval: "public" as const };

  it("does not count two distinct donor and public approvals toward quorum", () => {
    expect(
      isExpenseFullyApproved(
        [donorApproval, publicApproval],
        DEFAULT_FUND_POLICY,
        paise(5000),
        requesterId,
      ),
    ).toBe(false);
    expect(
      can(
        treasurerApprover,
        "expense:payout",
        expenseWith([donorApproval, publicApproval], {}, "approved"),
      ),
    ).toBe(false);
  });

  it("counts an approval recorded with owner or approver among its roles", () => {
    const multiRole = {
      approverId: approver1Id,
      roleAtApproval: "donor" as const,
      rolesAtApproval: ["donor", "approver"] as const,
    };
    expect(
      isExpenseFullyApproved(
        [multiRole, { approverId: approver2Id, roleAtApproval: "approver" }],
        DEFAULT_FUND_POLICY,
        paise(5000),
        requesterId,
      ),
    ).toBe(true);
  });

  it("does not count an approval with an empty or whitespace approver id", () => {
    const empties = [
      { approverId: "", roleAtApproval: "approver" as const },
      { approverId: "   ", roleAtApproval: "approver" as const },
      { approverId: approver1Id, roleAtApproval: "approver" as const },
    ];
    expect(isExpenseFullyApproved(empties, DEFAULT_FUND_POLICY, paise(5000), requesterId)).toBe(
      false,
    );
  });

  it("counts a padded duplicate of the same approver once", () => {
    const padded = [
      { approverId: approver1Id, roleAtApproval: "approver" as const },
      { approverId: ` ${approver1Id} `, roleAtApproval: "approver" as const },
    ];
    expect(isExpenseFullyApproved(padded, DEFAULT_FUND_POLICY, paise(5000), requesterId)).toBe(
      false,
    );
  });
});

describe("Treasurer approver and existing approvals (R5)", () => {
  // A treasurer-approver's own approval is recorded as approver; the other treasurer's approval
  // counts as eligible (approver) but is a treasurer approval, so it is not independent.
  const otherTreasurerApproval = {
    approverId: approver2Id,
    roleAtApproval: "approver" as const,
    rolesAtApproval: ["treasurer", "approver"] as const,
  };

  it("does not let an existing approval by the requester supply the independent approver", () => {
    const requesterApproved = [
      { approverId: requesterId, roleAtApproval: "approver" as const },
      otherTreasurerApproval,
    ];
    expect(can(treasurerApprover, "expense:approve", expenseWith(requesterApproved))).toBe(false);
  });

  it("does not let an ineligible donor approval supply the independent approver", () => {
    const donorAndTreasurer = [
      { approverId: approver1Id, roleAtApproval: "donor" as const },
      otherTreasurerApproval,
    ];
    expect(can(treasurerApprover, "expense:approve", expenseWith(donorAndTreasurer))).toBe(false);
  });

  it("allows a treasurer to approve when an eligible non-treasurer approval already exists", () => {
    const withApprover = [{ approverId: approver1Id, roleAtApproval: "approver" as const }];
    expect(can(treasurerApprover, "expense:approve", expenseWith(withApprover))).toBe(true);
  });
});

describe("Evidence lock after approval (R6)", () => {
  it("denies adding evidence once recorded approvals satisfy the policy, while still submitted", () => {
    expect(can({ role: "treasurer" }, "expense:add_evidence", expenseWith(twoApprovers))).toBe(
      false,
    );
  });

  it("allows adding evidence when the only approvals are ineligible", () => {
    const ineligible = [
      { approverId: approver1Id, roleAtApproval: "donor" as const },
      { approverId: approver2Id, roleAtApproval: "public" as const },
    ];
    expect(can({ role: "treasurer" }, "expense:add_evidence", expenseWith(ineligible))).toBe(true);
  });

  it("denies adding evidence when the approval state is unknown or malformed", () => {
    expect(can({ role: "treasurer" }, "expense:add_evidence", expenseWith("unknown"))).toBe(false);
    const missing: Resource = {
      kind: "expense",
      expense: {
        fundId,
        requesterId,
        amountPaise: paise(5000),
        status: "submitted",
        policy: DEFAULT_FUND_POLICY,
      },
    };
    expect(can({ role: "treasurer" }, "expense:add_evidence", missing)).toBe(false);
    expect(can({ role: "treasurer" }, "expense:add_evidence", expenseWith([null]))).toBe(false);
  });
});

describe("Objection window defaults (R9)", () => {
  it("denies raising an objection when objectionWindowOpen is omitted", () => {
    const res: Resource = {
      kind: "expense",
      expense: { fundId, requesterId, amountPaise: paise(1000), policy: DEFAULT_FUND_POLICY },
    };
    expect(can({ role: "donor" }, "expense:raise_objection", res)).toBe(false);
  });
});

describe("Quorum validation (R8)", () => {
  it.each([
    ["NaN", Number.NaN],
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 2],
  ])("denies payout and approval when approvalQuorum is %s", (_label, quorum) => {
    const bad = expenseWith(twoApprovers, { approvalQuorum: quorum });
    expect(can(treasurerApprover, "expense:payout", bad)).toBe(false);
    expect(
      isExpenseFullyApproved(
        twoApprovers,
        { ...DEFAULT_FUND_POLICY, approvalQuorum: quorum },
        paise(5000),
        requesterId,
      ),
    ).toBe(false);
    expect(can({ id: approver2Id, role: "approver" }, "expense:approve", bad)).toBe(false);
  });

  it("denies payout when a spend threshold carries a NaN quorum", () => {
    const bad = expenseWith(twoApprovers, {
      spendThresholds: [{ minAmountPaise: paise(0), requiredQuorum: Number.NaN }],
    });
    expect(can(treasurerApprover, "expense:payout", bad)).toBe(false);
  });
});

describe("Runtime role and tier validation (R10)", () => {
  const bankResource: Resource = { kind: "bank", bank: { fundId } };

  it("denies bank reconciliation for inherited property names used as roles", () => {
    expect(can({ id: ownerId, role: "toString" as FundRole }, "bank:reconcile", bankResource)).toBe(
      false,
    );
    expect(
      can({ role: "public", roles: ["constructor" as FundRole] }, "bank:reconcile", bankResource),
    ).toBe(false);
    expect(
      can(
        { role: "public", roles: "owner" as unknown as FundRole[] },
        "bank:reconcile",
        bankResource,
      ),
    ).toBe(false);
  });

  it("denies fund reads whose visibility tier is not a known tier", () => {
    const res = {
      kind: "fund",
      fund: { policy: { ...DEFAULT_FUND_POLICY, visibilityTier: "toString" } },
    } as unknown as Resource;
    expect(can({ role: "owner" }, "fund:read", res)).toBe(false);
    expect(can({ role: "public" }, "fund:read", res)).toBe(false);
  });

  it("honours the primary role together with secondary roles", () => {
    expect(
      can(
        { id: approver1Id, role: "approver", roles: ["donor"] },
        "expense:approve",
        expenseWith([]),
      ),
    ).toBe(true);
    expect(
      can({ id: ownerId, role: "public", roles: ["owner"] }, "bank:reconcile", bankResource),
    ).toBe(true);
  });
});
