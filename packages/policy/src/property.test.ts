import { type FundId, paise, parseFundId } from "@yen/shared";
import fc from "fast-check";
import { describe, it } from "vitest";
import { can, isExpenseFullyApproved } from "./engine.js";
import { type FundPolicy, requiredQuorumForExpense, VISIBILITY_TIERS } from "./policy.js";
import type { ApprovalRecord, Resource } from "./resources.js";
import { type Actor, FUND_ROLES, type FundRole } from "./roles.js";

function asFundId(id: string): FundId {
  const parsed = parseFundId(id);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const fundId = asFundId("00000000-0000-4000-8000-000000000001");

const fundRoleArbitrary = fc.constantFrom(...FUND_ROLES);
const visibilityTierArbitrary = fc.constantFrom(...VISIBILITY_TIERS);

const spendThresholdArbitrary = fc.record({
  minAmountPaise: fc.integer({ min: 1, max: 1_000_000_000 }).map(paise),
  requiredQuorum: fc.integer({ min: 2, max: 15 }),
});

const policyArbitrary = fc.record({
  visibilityTier: visibilityTierArbitrary,
  approvalQuorum: fc.integer({ min: 1, max: 10 }),
  spendThresholds: fc.array(spendThresholdArbitrary, { maxLength: 4 }),
  objectionWindowHours: fc.integer({ min: 0, max: 168 }),
});

const uuidArbitrary = fc.uuid();
const pseudonymArbitrary = uuidArbitrary.map((u) => `psn_${u}`);

const requesterArbitrary = fc.constantFrom(
  "psn_00000000-0000-4000-8000-0000000000a1",
  "psn_00000000-0000-4000-8000-0000000000a2",
  "",
);

/** Ids drawn from a small pool so duplicates, padded copies and empty ids all occur. */
const approverIdArbitrary = fc.constantFrom(
  "psn_00000000-0000-4000-8000-0000000000a1",
  "psn_00000000-0000-4000-8000-0000000000a2",
  "psn_00000000-0000-4000-8000-0000000000a3",
  " psn_00000000-0000-4000-8000-0000000000a2 ",
  "",
  "   ",
);

const approvalArbitrary: fc.Arbitrary<ApprovalRecord> = fc.record({
  approverId: approverIdArbitrary,
  roleAtApproval: fundRoleArbitrary,
  rolesAtApproval: fc.array(fundRoleArbitrary, { maxLength: 2 }),
});

/**
 * Independent oracle for the approval rule: an approval counts when its id is non-empty after
 * trimming, is not the requester, has owner or approver among its recorded roles, and is the
 * first such record for that id. Returns the count and whether one counted approver is not a
 * treasurer.
 */
function eligibleApprovalOracle(
  approvals: readonly ApprovalRecord[],
  requesterId: string,
): { count: number; hasNonTreasurer: boolean } {
  const requester = requesterId.trim();
  const seen = new Set<string>();
  let count = 0;
  let hasNonTreasurer = false;
  for (const approval of approvals) {
    const id = approval.approverId.trim();
    if (id === "" || id === requester) continue;
    const roles: readonly string[] = [approval.roleAtApproval, ...(approval.rolesAtApproval ?? [])];
    if (!roles.includes("owner") && !roles.includes("approver")) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    count++;
    if (!roles.includes("treasurer")) hasNonTreasurer = true;
  }
  return { count, hasNonTreasurer };
}

describe("Property-based fuzz tests (fast-check)", () => {
  it("Invariant 1: No actor can ever approve their own expense request", () => {
    fc.assert(
      fc.property(
        policyArbitrary,
        pseudonymArbitrary,
        fc.integer({ min: 1, max: 500_000_000 }),
        fundRoleArbitrary,
        fc.array(fundRoleArbitrary, { maxLength: 3 }),
        (
          policy: FundPolicy,
          requesterId: string,
          amountRaw: number,
          primaryRole: FundRole,
          extraRoles: FundRole[],
        ) => {
          const amountPaise = paise(amountRaw);
          const resource: Resource = {
            kind: "expense",
            expense: {
              fundId,
              requesterId,
              amountPaise,
              policy,
              status: "submitted",
              approvals: [],
            },
          };

          // The actor's ID matches the requester's ID
          const actor: Actor = {
            id: requesterId,
            role: primaryRole,
            roles: [primaryRole, ...extraRoles],
          };

          const allowed = can(actor, "expense:approve", resource);
          // MUST ALWAYS BE FALSE
          return allowed === false;
        },
      ),
      { numRuns: 500 },
    );
  });

  it("Invariant 2: The treasurer can NEVER be the sole approver", () => {
    fc.assert(
      fc.property(
        policyArbitrary,
        pseudonymArbitrary,
        pseudonymArbitrary,
        fc.integer({ min: 1, max: 500_000_000 }),
        (policyInput: FundPolicy, requesterId: string, treasurerId: string, amountRaw: number) => {
          fc.pre(requesterId !== treasurerId);

          const amountPaise = paise(amountRaw);
          // Force quorum = 1 to test sole approver scenario
          const quorum1Policy: FundPolicy = {
            ...policyInput,
            approvalQuorum: 1,
            spendThresholds: [],
          };

          const resource: Resource = {
            kind: "expense",
            expense: {
              fundId,
              requesterId,
              amountPaise,
              policy: quorum1Policy,
            },
          };

          // Treasurer attempting to approve as sole approver
          const treasurerActor: Actor = {
            id: treasurerId,
            role: "treasurer",
            roles: ["treasurer", "approver"], // Even with approver role!
          };

          const canApprove = can(treasurerActor, "expense:approve", resource);
          if (canApprove !== false) return false;

          // Also verify through isExpenseFullyApproved:
          // A single approval from a treasurer can NEVER decide the expense
          const singleTreasurerApproval: ApprovalRecord[] = [
            { approverId: treasurerId, roleAtApproval: "treasurer" },
          ];
          const isApproved = isExpenseFullyApproved(
            singleTreasurerApproval,
            quorum1Policy,
            amountPaise,
            requesterId,
          );
          return isApproved === false;
        },
      ),
      { numRuns: 500 },
    );
  });

  it("Invariant 3: isExpenseFullyApproved agrees with an independent oracle over eligible approvals", () => {
    fc.assert(
      fc.property(
        policyArbitrary,
        requesterArbitrary,
        fc.integer({ min: 1, max: 500_000_000 }),
        fc.array(approvalArbitrary, { minLength: 0, maxLength: 10 }),
        (
          policy: FundPolicy,
          requesterId: string,
          amountRaw: number,
          approvals: ApprovalRecord[],
        ) => {
          const amountPaise = paise(amountRaw);
          const isApproved = isExpenseFullyApproved(approvals, policy, amountPaise, requesterId);
          const oracle = eligibleApprovalOracle(approvals, requesterId);
          const required = requiredQuorumForExpense(policy, amountPaise);
          return (
            isApproved ===
            (requesterId.trim() !== "" && oracle.count >= required && oracle.hasNonTreasurer)
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it("Invariant 4: an actor without a usable id can never approve an expense", () => {
    fc.assert(
      fc.property(
        policyArbitrary,
        requesterArbitrary,
        fc.integer({ min: 1, max: 500_000_000 }),
        fundRoleArbitrary,
        fc.array(fundRoleArbitrary, { maxLength: 3 }),
        fc.constantFrom<string | undefined>(undefined, "", "   ", "\t"),
        fc.array(approvalArbitrary, { maxLength: 4 }),
        (
          policy: FundPolicy,
          requesterId: string,
          amountRaw: number,
          primaryRole: FundRole,
          extraRoles: FundRole[],
          noId: string | undefined,
          approvals: ApprovalRecord[],
        ) => {
          const actor: Actor = { id: noId, role: primaryRole, roles: [primaryRole, ...extraRoles] };
          const resource: Resource = {
            kind: "expense",
            expense: {
              fundId,
              requesterId,
              amountPaise: paise(amountRaw),
              policy,
              status: "submitted",
              approvals,
            },
          };
          return can(actor, "expense:approve", resource) === false;
        },
      ),
      { numRuns: 500 },
    );
  });

  it("Invariant 5: payout is never allowed for paid or rejected expenses, whatever the approvals", () => {
    fc.assert(
      fc.property(
        policyArbitrary,
        requesterArbitrary,
        fc.integer({ min: 1, max: 500_000_000 }),
        fc.constantFrom("paid", "rejected"),
        fundRoleArbitrary,
        fc.array(approvalArbitrary, { maxLength: 6 }),
        (
          policy: FundPolicy,
          requesterId: string,
          amountRaw: number,
          status: "paid" | "rejected",
          role: FundRole,
          approvals: ApprovalRecord[],
        ) => {
          const resource: Resource = {
            kind: "expense",
            expense: {
              fundId,
              requesterId,
              amountPaise: paise(amountRaw),
              policy,
              status,
              approvals,
            },
          };
          return (
            can(
              { id: "psn_00000000-0000-4000-8000-0000000000ff", role },
              "expense:payout",
              resource,
            ) === false
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it("Invariant 6: payout is never allowed with fewer than quorum eligible approvals", () => {
    fc.assert(
      fc.property(
        policyArbitrary,
        requesterArbitrary,
        fc.integer({ min: 1, max: 500_000_000 }),
        fc.constantFrom<"submitted" | "approved">("submitted", "approved"),
        fc.array(approvalArbitrary, { maxLength: 8 }),
        (
          policy: FundPolicy,
          requesterId: string,
          amountRaw: number,
          status: "submitted" | "approved",
          approvals: ApprovalRecord[],
        ) => {
          const resource: Resource = {
            kind: "expense",
            expense: {
              fundId,
              requesterId,
              amountPaise: paise(amountRaw),
              policy,
              status,
              approvals,
            },
          };
          const allowed = can(
            { id: "psn_00000000-0000-4000-8000-0000000000ff", role: "owner" },
            "expense:payout",
            resource,
          );
          if (!allowed) return true;
          const required = requiredQuorumForExpense(policy, paise(amountRaw));
          const oracle = eligibleApprovalOracle(approvals, requesterId);
          return oracle.count >= required && oracle.hasNonTreasurer;
        },
      ),
      { numRuns: 500 },
    );
  });
});
