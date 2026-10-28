import type { PseudonymId } from "@yen/eventlog";
import { paise } from "@yen/shared";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { findStaleExpenses, processStaleExpenses } from "./expiry-job.js";
import { createMockPasskeyApproval } from "./passkey.js";
import {
  addSignedApproval,
  canTransition,
  createDraftRequest,
  createNewVersion,
  editDraftRequest,
  evaluateObjectionWindow,
  expireExpense,
  payExpense,
  reconcileExpense,
  rejectExpense,
  submitExpense,
} from "./state-machine.js";
import { InMemoryExpenseStore } from "./store.js";
import {
  DuplicateApprovalError,
  ExpenseNotEditableError,
  type FundPolicy,
  InvalidPasskeySignatureError,
  SeparationOfDutiesError,
} from "./types.js";

const FUND_ID = "00000000-0000-7000-8000-000000000001";
const REQUESTER_ID = "psn_00000000-0000-7000-8000-000000000010" as PseudonymId;
const APPROVER_1 = "psn_00000000-0000-7000-8000-000000000021" as PseudonymId;
const APPROVER_2 = "psn_00000000-0000-7000-8000-000000000022" as PseudonymId;
const APPROVER_3 = "psn_00000000-0000-7000-8000-000000000023" as PseudonymId;

const DEFAULT_POLICY: FundPolicy = {
  approvalQuorum: 2,
  objectionWindowHours: 0,
  autoExpireHours: 72,
};

describe("Expense Request State Machine", () => {
  it("completes full happy path lifecycle: draft -> submitted -> approved -> paid -> reconciled", () => {
    const t0 = "2026-10-28T10:00:00.000Z";
    const draft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(50000),
      description: "Sound equipment rental",
      recipientRef: "rcpt_sound_services_01",
      createdAt: t0,
    });

    expect(draft.status).toBe("draft");
    expect(draft.holdId).toBeNull();
    expect(draft.amountPaise).toBe(paise(50000));

    // Can edit draft before submission
    const editedDraft = editDraftRequest(draft, {
      description: "Sound equipment and microphone rental",
    });
    expect(editedDraft.description).toBe("Sound equipment and microphone rental");

    // Transition: draft -> submitted
    const t1 = "2026-10-28T10:05:00.000Z";
    const submitted = submitExpense(editedDraft, {
      holdId: "hold_uuid_001",
      policy: DEFAULT_POLICY,
      nowUtc: t1,
    });
    expect(submitted.status).toBe("submitted");
    expect(submitted.holdId).toBe("hold_uuid_001");
    expect(submitted.submittedAt).toBe(t1);
    expect(submitted.expiresAt).toBe("2026-10-31T10:05:00.000Z");

    // Approver 1 signs
    const t2 = "2026-10-28T10:10:00.000Z";
    const approval1 = createMockPasskeyApproval(APPROVER_1, submitted, t2);
    const step1 = addSignedApproval(submitted, approval1, DEFAULT_POLICY, t2);
    expect(step1.reachedQuorum).toBe(false);
    expect(step1.expense.status).toBe("submitted");
    expect(step1.expense.approvals).toHaveLength(1);

    // Approver 2 signs: reaches quorum of 2!
    const t3 = "2026-10-28T10:15:00.000Z";
    const approval2 = createMockPasskeyApproval(APPROVER_2, step1.expense, t3);
    const step2 = addSignedApproval(step1.expense, approval2, DEFAULT_POLICY, t3);
    expect(step2.reachedQuorum).toBe(true);
    expect(step2.expense.status).toBe("approved");
    expect(step2.expense.approvedAt).toBe(t3);
    expect(step2.expense.approvals).toHaveLength(2);

    // Transition: approved -> paid
    const t4 = "2026-10-28T10:30:00.000Z";
    const bankTxId = "00000000-0000-7000-8000-000000000099";
    const paid = payExpense(step2.expense, bankTxId, t4);
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).toBe(t4);
    expect(paid.bankTransactionId).toBe(bankTxId);

    // Transition: paid -> reconciled
    const t5 = "2026-10-28T11:00:00.000Z";
    const reconciled = reconcileExpense(paid, bankTxId, t5);
    expect(reconciled.status).toBe("reconciled");
    expect(reconciled.reconciledAt).toBe(t5);
  });

  it("handles rejection lifecycle: draft -> submitted -> rejected", () => {
    const draft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(30000),
      description: "Printing banners",
      recipientRef: "rcpt_print_01",
    });

    const submitted = submitExpense(draft, {
      holdId: "hold_uuid_002",
      policy: DEFAULT_POLICY,
    });

    const tReject = "2026-10-28T11:00:00.000Z";
    const rejected = rejectExpense(submitted, "policy", tReject);
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectedAt).toBe(tReject);
    expect(rejected.rejectionReason).toBe("policy");
  });

  it("handles expiration lifecycle: draft -> submitted -> expired", () => {
    const draft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(25000),
      description: "Travel reimbursement",
      recipientRef: "rcpt_travel_01",
    });

    const submitted = submitExpense(draft, {
      holdId: "hold_uuid_003",
      policy: DEFAULT_POLICY,
    });

    const tExpire = "2026-10-31T12:00:00.000Z";
    const expired = expireExpense(submitted, tExpire);
    expect(expired.status).toBe("expired");
    expect(expired.expiredAt).toBe(tExpire);
  });

  it("enforces separation of duties: requester cannot approve their own expense", () => {
    const draft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(10000),
      description: "Office supplies",
      recipientRef: "rcpt_supplies",
    });

    const submitted = submitExpense(draft, {
      holdId: "hold_uuid_004",
      policy: DEFAULT_POLICY,
    });

    const selfApproval = createMockPasskeyApproval(
      REQUESTER_ID,
      submitted,
      "2026-10-28T10:00:00.000Z",
    );
    expect(() => addSignedApproval(submitted, selfApproval, DEFAULT_POLICY)).toThrow(
      SeparationOfDutiesError,
    );
  });

  it("rejects duplicate approval from the same approver", () => {
    const draft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(10000),
      description: "Snacks",
      recipientRef: "rcpt_snacks",
    });

    const submitted = submitExpense(draft, {
      holdId: "hold_uuid_005",
      policy: DEFAULT_POLICY,
    });

    const approval1 = createMockPasskeyApproval(APPROVER_1, submitted, "2026-10-28T10:00:00.000Z");
    const step1 = addSignedApproval(submitted, approval1, DEFAULT_POLICY);

    const duplicateApproval = createMockPasskeyApproval(
      APPROVER_1,
      step1.expense,
      "2026-10-28T10:01:00.000Z",
    );
    expect(() => addSignedApproval(step1.expense, duplicateApproval, DEFAULT_POLICY)).toThrow(
      DuplicateApprovalError,
    );
  });

  it("rejects forged or unbound passkey signatures", () => {
    const draft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(10000),
      description: "Stickers",
      recipientRef: "rcpt_stickers",
    });

    const submitted = submitExpense(draft, {
      holdId: "hold_uuid_006",
      policy: DEFAULT_POLICY,
    });

    // Approval created for a different amount (tampered)
    const forgedApproval = createMockPasskeyApproval(
      APPROVER_1,
      { ...submitted, amountPaise: paise(999999) },
      "2026-10-28T10:00:00.000Z",
    );

    expect(() => addSignedApproval(submitted, forgedApproval, DEFAULT_POLICY)).toThrow(
      InvalidPasskeySignatureError,
    );
  });

  it("enforces immutability: request cannot be edited after submission (new version = new request, linked)", () => {
    const draft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(10000),
      description: "Initial description",
      recipientRef: "rcpt_vendor",
    });

    const submitted = submitExpense(draft, {
      holdId: "hold_uuid_007",
      policy: DEFAULT_POLICY,
    });

    // Attempting to edit submitted expense throws ExpenseNotEditableError
    expect(() => editDraftRequest(submitted, { description: "Altered description" })).toThrow(
      ExpenseNotEditableError,
    );

    // Creating new version produces a new request with supersedesId linked
    const newVersion = createNewVersion(submitted, {
      description: "Corrected description with updated quote",
      amountPaise: paise(12000),
    });

    expect(newVersion.status).toBe("draft");
    expect(newVersion.id).not.toBe(submitted.id);
    expect(newVersion.supersedesId).toBe(submitted.id);
    expect(newVersion.amountPaise).toBe(paise(12000));
    expect(newVersion.description).toBe("Corrected description with updated quote");
  });

  it("satisfies AC: two approvers approving simultaneously reach quorum exactly once", async () => {
    const store = new InMemoryExpenseStore();
    const draft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(50000),
      description: "Catering",
      recipientRef: "rcpt_catering",
    });

    const submitted = submitExpense(draft, {
      holdId: "hold_uuid_008",
      policy: DEFAULT_POLICY, // quorum = 2
    });
    await store.save(submitted);

    const approval1 = createMockPasskeyApproval(APPROVER_1, submitted, "2026-10-28T12:00:00.000Z");
    const approval2 = createMockPasskeyApproval(APPROVER_2, submitted, "2026-10-28T12:00:00.000Z");

    // Run simultaneous approvals
    const [res1, res2] = await Promise.all([
      store.atomicApprove(submitted.id, approval1, DEFAULT_POLICY),
      store.atomicApprove(submitted.id, approval2, DEFAULT_POLICY),
    ]);

    // Exactly one reaches quorum!
    const reachedCount = (res1.reachedQuorum ? 1 : 0) + (res2.reachedQuorum ? 1 : 0);
    expect(reachedCount).toBe(1);

    const final = await store.get(submitted.id);
    expect(final?.status).toBe("approved");
    expect(final?.approvals).toHaveLength(2);
  });

  it("respects amount thresholds for quorum", () => {
    const tieredPolicy: FundPolicy = {
      approvalQuorum: 1, // default for <= 10,000 paise
      objectionWindowHours: 0,
      autoExpireHours: 72,
      amountThresholds: [
        { maxPaise: paise(10000), quorum: 1 },
        { maxPaise: paise(100000), quorum: 2 },
        { maxPaise: paise(1000000), quorum: 3 },
      ],
    };

    // Small expense: quorum is 1
    const smallDraft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(5000),
      description: "Tea",
      recipientRef: "rcpt_tea",
    });
    const smallSubmitted = submitExpense(smallDraft, {
      holdId: "h1",
      policy: tieredPolicy,
    });
    const smallApproval = createMockPasskeyApproval(
      APPROVER_1,
      smallSubmitted,
      "2026-10-28T10:00:00Z",
    );
    const smallResult = addSignedApproval(smallSubmitted, smallApproval, tieredPolicy);
    expect(smallResult.reachedQuorum).toBe(true);
    expect(smallResult.expense.status).toBe("approved");

    // Medium expense: quorum is 2
    const medDraft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(50000),
      description: "Venue deposit",
      recipientRef: "rcpt_venue",
    });
    const medSubmitted = submitExpense(medDraft, {
      holdId: "h2",
      policy: tieredPolicy,
    });
    const medApp1 = createMockPasskeyApproval(APPROVER_1, medSubmitted, "2026-10-28T10:00:00Z");
    const medRes1 = addSignedApproval(medSubmitted, medApp1, tieredPolicy);
    expect(medRes1.reachedQuorum).toBe(false);

    const medApp2 = createMockPasskeyApproval(APPROVER_2, medRes1.expense, "2026-10-28T10:01:00Z");
    const medRes2 = addSignedApproval(medRes1.expense, medApp2, tieredPolicy);
    expect(medRes2.reachedQuorum).toBe(true);
    expect(medRes2.expense.status).toBe("approved");
  });

  it("handles objection window correctly", () => {
    const policyWithWindow: FundPolicy = {
      approvalQuorum: 1,
      objectionWindowHours: 24,
      autoExpireHours: 72,
    };

    const tSubmit = "2026-10-28T10:00:00.000Z";
    const draft = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(50000),
      description: "Workshop equipment",
      recipientRef: "rcpt_workshop",
      createdAt: tSubmit,
    });

    const submitted = submitExpense(draft, {
      holdId: "h_window",
      policy: policyWithWindow,
      nowUtc: tSubmit,
    });
    expect(submitted.objectionEndsAt).toBe("2026-10-29T10:00:00.000Z");

    // Approving while window is active records approval, but does not transition to approved yet
    const tApprove = "2026-10-28T15:00:00.000Z";
    const app = createMockPasskeyApproval(APPROVER_1, submitted, tApprove);
    const step1 = addSignedApproval(submitted, app, policyWithWindow, tApprove);
    expect(step1.reachedQuorum).toBe(false);
    expect(step1.expense.status).toBe("submitted");
    expect(step1.expense.approvals).toHaveLength(1);

    // Still in window
    const checkBefore = evaluateObjectionWindow(
      step1.expense,
      policyWithWindow,
      "2026-10-29T09:59:00.000Z",
    );
    expect(checkBefore.transitioned).toBe(false);

    // After window ends
    const checkAfter = evaluateObjectionWindow(
      step1.expense,
      policyWithWindow,
      "2026-10-29T10:01:00.000Z",
    );
    expect(checkAfter.transitioned).toBe(true);
    expect(checkAfter.expense.status).toBe("approved");
  });

  it("detects and processes stale expenses via expiry job", async () => {
    const t0 = "2026-10-28T10:00:00.000Z";
    const draft1 = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(10000),
      description: "Stale request",
      recipientRef: "rcpt_1",
    });
    const submitted1 = submitExpense(draft1, {
      holdId: "h_stale",
      policy: { approvalQuorum: 2, objectionWindowHours: 0, autoExpireHours: 24 },
      nowUtc: t0,
    });

    const draft2 = createDraftRequest({
      fundId: FUND_ID,
      requesterId: REQUESTER_ID,
      amountPaise: paise(20000),
      description: "Fresh request",
      recipientRef: "rcpt_2",
    });
    const submitted2 = submitExpense(draft2, {
      holdId: "h_fresh",
      policy: { approvalQuorum: 2, objectionWindowHours: 0, autoExpireHours: 72 },
      nowUtc: t0,
    });

    // Check after 30 hours: submitted1 is stale (>24h), submitted2 is fresh (<72h)
    const tCheck = "2026-10-29T16:00:00.000Z";
    const stale = findStaleExpenses([submitted1, submitted2], tCheck);
    expect(stale).toHaveLength(1);
    expect(stale[0]?.id).toBe(submitted1.id);

    const expiredList: string[] = [];
    await processStaleExpenses([submitted1, submitted2], tCheck, (exp) => {
      expiredList.push(exp.id);
    });
    expect(expiredList).toEqual([submitted1.id]);
  });

  it("exhaustively tests canTransition matrix", () => {
    const allStatuses = [
      "draft",
      "submitted",
      "approved",
      "rejected",
      "expired",
      "paid",
      "reconciled",
    ] as const;

    const allowedPairs = new Set([
      "draft->submitted",
      "submitted->approved",
      "submitted->rejected",
      "submitted->expired",
      "approved->paid",
      "paid->reconciled",
    ]);

    for (const from of allStatuses) {
      for (const to of allStatuses) {
        const pair = `${from}->${to}`;
        expect(canTransition(from, to)).toBe(allowedPairs.has(pair));
      }
    }
  });

  describe("AC: State-machine property tests (fast-check)", () => {
    it("no sequence of operations reaches an illegal state or double-spends/double-releases a hold", () => {
      type Action =
        | { type: "submit"; holdId: string }
        | { type: "approve"; approver: PseudonymId; forged?: boolean }
        | { type: "reject"; reason: "quorum" | "objection" | "policy" }
        | { type: "expire" }
        | { type: "pay"; bankTxId: string }
        | { type: "reconcile"; bankTxId: string }
        | { type: "edit"; newAmount: number };

      const approversPool = [
        "psn_00000000-0000-7000-8000-000000000010" as PseudonymId, // requester
        APPROVER_1,
        APPROVER_2,
        APPROVER_3,
      ];

      const actionArbitrary: fc.Arbitrary<Action> = fc.oneof(
        fc.string({ minLength: 3, maxLength: 8 }).map((s) => ({
          type: "submit" as const,
          holdId: `hold_${s}`,
        })),
        fc
          .record({
            approver: fc.constantFrom(...approversPool),
            forged: fc.boolean(),
          })
          .map(({ approver, forged }) => ({
            type: "approve" as const,
            approver,
            forged,
          })),
        fc
          .constantFrom("quorum" as const, "objection" as const, "policy" as const)
          .map((reason) => ({ type: "reject" as const, reason })),
        fc.constant({ type: "expire" as const }),
        fc.uuid().map((bankTxId) => ({ type: "pay" as const, bankTxId })),
        fc.uuid().map((bankTxId) => ({ type: "reconcile" as const, bankTxId })),
        fc.integer({ min: 1, max: 1_000_000 }).map((newAmount) => ({
          type: "edit" as const,
          newAmount,
        })),
      );

      fc.assert(
        fc.property(fc.array(actionArbitrary, { minLength: 1, maxLength: 30 }), (actions) => {
          let expense = createDraftRequest({
            fundId: FUND_ID,
            requesterId: REQUESTER_ID,
            amountPaise: paise(50000),
            description: "Property test expense",
            recipientRef: "rcpt_test",
          });

          let holdCreatedCount = 0;
          let holdReleasedCount = 0;
          let holdSettledCount = 0;

          for (const action of actions) {
            const initialStatus = expense.status;

            try {
              switch (action.type) {
                case "edit": {
                  expense = editDraftRequest(expense, {
                    amountPaise: paise(action.newAmount),
                  });
                  expect(initialStatus).toBe("draft");
                  break;
                }
                case "submit": {
                  expense = submitExpense(expense, {
                    holdId: action.holdId,
                    policy: DEFAULT_POLICY,
                  });
                  expect(initialStatus).toBe("draft");
                  expect(expense.status).toBe("submitted");
                  holdCreatedCount++;
                  break;
                }
                case "approve": {
                  const target = action.forged
                    ? { ...expense, amountPaise: paise(999999) }
                    : expense;
                  const approval = createMockPasskeyApproval(
                    action.approver,
                    target,
                    new Date().toISOString(),
                  );
                  const res = addSignedApproval(expense, approval, DEFAULT_POLICY);
                  expense = res.expense;
                  expect(initialStatus).toBe("submitted");
                  break;
                }
                case "reject": {
                  expense = rejectExpense(expense, action.reason);
                  expect(initialStatus).toBe("submitted");
                  expect(expense.status).toBe("rejected");
                  holdReleasedCount++;
                  break;
                }
                case "expire": {
                  expense = expireExpense(expense);
                  expect(initialStatus).toBe("submitted");
                  expect(expense.status).toBe("expired");
                  holdReleasedCount++;
                  break;
                }
                case "pay": {
                  expense = payExpense(expense, action.bankTxId);
                  expect(initialStatus).toBe("approved");
                  expect(expense.status).toBe("paid");
                  holdSettledCount++;
                  break;
                }
                case "reconcile": {
                  expense = reconcileExpense(expense, action.bankTxId);
                  expect(initialStatus).toBe("paid");
                  expect(expense.status).toBe("reconciled");
                  break;
                }
              }
            } catch {
              // Expected for invalid operations — status must remain valid and unchanged!
              expect(expense.status).toBe(initialStatus);
            }

            // Invariant: hold is created at most once
            expect(holdCreatedCount).toBeLessThanOrEqual(1);

            // Invariant: hold can only be settled or released if it was created
            if (holdSettledCount > 0 || holdReleasedCount > 0) {
              expect(holdCreatedCount).toBe(1);
            }

            // Invariant: hold cannot be both settled and released, and cannot be double-spent
            expect(holdSettledCount + holdReleasedCount).toBeLessThanOrEqual(1);

            // Invariant: approvers never include requester
            for (const a of expense.approvals) {
              expect(a.approverId).not.toBe(REQUESTER_ID);
            }

            // Invariant: no duplicate approvers
            const approverIds = expense.approvals.map((a) => a.approverId);
            expect(new Set(approverIds).size).toBe(approverIds.length);
          }
        }),
        { numRuns: 200 },
      );
    });
  });
});
