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

  it("Invariant 3: Full approval requires meeting quorum without requester and with at least one non-treasurer", () => {
    const approvalArbitrary = fc.record({
      approverId: pseudonymArbitrary,
      roleAtApproval: fundRoleArbitrary,
      rolesAtApproval: fc.array(fundRoleArbitrary, { maxLength: 2 }),
    });

    fc.assert(
      fc.property(
        policyArbitrary,
        pseudonymArbitrary,
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

          if (isApproved) {
            const required = requiredQuorumForExpense(policy, amountPaise);

            // 1. Must have at least required quorum
            const distinctNonRequesterIds = new Set(
              approvals.filter((a) => a.approverId !== requesterId).map((a) => a.approverId),
            );
            if (distinctNonRequesterIds.size < required) return false;

            // 2. Requester cannot be an approver
            if (distinctNonRequesterIds.has(requesterId)) return false;

            // 3. Must have at least one non-treasurer approver
            const hasNonTreasurer = approvals.some(
              (a) =>
                a.approverId !== requesterId &&
                a.roleAtApproval !== "treasurer" &&
                !a.rolesAtApproval?.includes("treasurer"),
            );
            if (!hasNonTreasurer) return false;
          }

          return true;
        },
      ),
      { numRuns: 500 },
    );
  });
});
