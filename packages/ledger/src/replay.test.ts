import {
  chainHead,
  checkChainStructure,
  type Event,
  makeNextEvent,
  type PseudonymId,
  verifyChain,
} from "@yen/eventlog";
import { parseFundId } from "@yen/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toEventInput } from "./eventlog.js";
import { replayFundEvents } from "./replay.js";

const FUND_ID = "0194ebc4-94e8-7000-8000-000000000001";
const ACTOR: PseudonymId = "psn_0194ebc4-94e8-7000-8000-000000000002" as PseudonymId;

function validFundId(id: string) {
  const parsed = parseFundId(id);
  if (!parsed.ok) throw new Error("Invalid fund id");
  return parsed.value;
}

describe("replayFundEvents unit tests", () => {
  it("initializes empty balances when no events are recorded", () => {
    const balances = replayFundEvents(FUND_ID, []);
    expect(balances).toEqual({
      fundId: FUND_ID,
      bankPaise: 0n,
      pendingSpendPaise: 0n,
      availablePaise: 0n,
      donationsPaise: 0n,
      expensesPaise: 0n,
    });
  });

  it("does not affect bank balance on unverified donation pledge", async () => {
    const pledge = await makeNextEvent(
      null,
      toEventInput({
        fund_id: FUND_ID,
        actor: ACTOR,
        occurred_at: "2027-01-01T10:00:00.000Z",
        type: "donation.pledged",
        payload: {
          donation_id: "0194ebc4-94e8-7000-8000-000000000010",
          amount_paise: 50000,
        },
      }),
    );

    const balances = replayFundEvents(FUND_ID, [pledge]);
    expect(balances.bankPaise).toBe(0n);
    expect(balances.availablePaise).toBe(0n);
    expect(balances.donationsPaise).toBe(0n);
  });

  it("updates bank and donations once pledge is verified", async () => {
    const pledge = await makeNextEvent(
      null,
      toEventInput({
        fund_id: FUND_ID,
        actor: ACTOR,
        occurred_at: "2027-01-01T10:00:00.000Z",
        type: "donation.pledged",
        payload: {
          donation_id: "0194ebc4-94e8-7000-8000-000000000010",
          amount_paise: 50000,
        },
      }),
    );

    const verified = await makeNextEvent(
      pledge,
      toEventInput({
        fund_id: FUND_ID,
        actor: ACTOR,
        occurred_at: "2027-01-01T10:01:00.000Z",
        type: "donation.verified",
        payload: {
          donation_id: "0194ebc4-94e8-7000-8000-000000000010",
          bank_transaction_id: "0194ebc4-94e8-7000-8000-000000000020",
        },
      }),
    );

    const balances = replayFundEvents(FUND_ID, [pledge, verified]);
    expect(balances.bankPaise).toBe(50000n);
    expect(balances.availablePaise).toBe(50000n);
    expect(balances.donationsPaise).toBe(50000n);
    expect(balances.expensesPaise).toBe(0n);
    expect(balances.pendingSpendPaise).toBe(0n);
  });

  it("pending spend reduces available balance but not bank balance", async () => {
    let prev: Event | null = null;
    const events: Event[] = [];

    const pledge = await makeNextEvent(
      prev,
      toEventInput({
        fund_id: FUND_ID,
        actor: ACTOR,
        occurred_at: "2027-01-01T10:00:00.000Z",
        type: "donation.pledged",
        payload: {
          donation_id: "0194ebc4-94e8-7000-8000-000000000010",
          amount_paise: 100000,
        },
      }),
    );
    events.push(pledge);
    prev = pledge;

    const verified = await makeNextEvent(
      prev,
      toEventInput({
        fund_id: FUND_ID,
        actor: ACTOR,
        occurred_at: "2027-01-01T10:01:00.000Z",
        type: "donation.verified",
        payload: {
          donation_id: "0194ebc4-94e8-7000-8000-000000000010",
          bank_transaction_id: "0194ebc4-94e8-7000-8000-000000000020",
        },
      }),
    );
    events.push(verified);
    prev = verified;

    const submitted = await makeNextEvent(
      prev,
      toEventInput({
        fund_id: FUND_ID,
        actor: ACTOR,
        occurred_at: "2027-01-01T10:02:00.000Z",
        type: "expense.submitted",
        payload: {
          expense_id: "0194ebc4-94e8-7000-8000-000000000030",
          amount_paise: 40000,
        },
      }),
    );
    events.push(submitted);
    prev = submitted;

    const balances = replayFundEvents(FUND_ID, events);
    expect(balances.bankPaise).toBe(100000n);
    expect(balances.pendingSpendPaise).toBe(40000n);
    expect(balances.availablePaise).toBe(60000n);
    expect(balances.donationsPaise).toBe(100000n);
    expect(balances.expensesPaise).toBe(0n);
  });

  it("settling expense decreases bank, increases expenses, and clears pending spend", async () => {
    let prev: Event | null = null;
    const events: Event[] = [];

    const addEvent = async (raw: Parameters<typeof toEventInput>[0]) => {
      const input = toEventInput(raw);
      const ev = await makeNextEvent(prev, input);
      events.push(ev);
      prev = ev;
      return ev;
    };

    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:00:00.000Z",
      type: "donation.pledged",
      payload: {
        donation_id: "0194ebc4-94e8-7000-8000-000000000010",
        amount_paise: 100000,
      },
    });

    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:01:00.000Z",
      type: "donation.verified",
      payload: {
        donation_id: "0194ebc4-94e8-7000-8000-000000000010",
        bank_transaction_id: "0194ebc4-94e8-7000-8000-000000000020",
      },
    });

    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:02:00.000Z",
      type: "expense.submitted",
      payload: {
        expense_id: "0194ebc4-94e8-7000-8000-000000000030",
        amount_paise: 40000,
      },
    });

    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:03:00.000Z",
      type: "expense.approved",
      payload: {
        expense_id: "0194ebc4-94e8-7000-8000-000000000030",
      },
    });

    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:04:00.000Z",
      type: "expense.paid",
      payload: {
        expense_id: "0194ebc4-94e8-7000-8000-000000000030",
        bank_transaction_id: "0194ebc4-94e8-7000-8000-000000000040",
      },
    });

    const balances = replayFundEvents(FUND_ID, events);
    expect(balances.bankPaise).toBe(60000n);
    expect(balances.pendingSpendPaise).toBe(0n);
    expect(balances.availablePaise).toBe(60000n);
    expect(balances.donationsPaise).toBe(100000n);
    expect(balances.expensesPaise).toBe(40000n);
  });

  it("releasing expense returns pending spend to available balance", async () => {
    let prev: Event | null = null;
    const events: Event[] = [];

    const addEvent = async (raw: Parameters<typeof toEventInput>[0]) => {
      const input = toEventInput(raw);
      const ev = await makeNextEvent(prev, input);
      events.push(ev);
      prev = ev;
      return ev;
    };

    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:00:00.000Z",
      type: "donation.pledged",
      payload: {
        donation_id: "0194ebc4-94e8-7000-8000-000000000010",
        amount_paise: 100000,
      },
    });

    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:01:00.000Z",
      type: "donation.verified",
      payload: {
        donation_id: "0194ebc4-94e8-7000-8000-000000000010",
        bank_transaction_id: "0194ebc4-94e8-7000-8000-000000000020",
      },
    });

    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:02:00.000Z",
      type: "expense.submitted",
      payload: {
        expense_id: "0194ebc4-94e8-7000-8000-000000000030",
        amount_paise: 40000,
      },
    });

    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:03:00.000Z",
      type: "expense.rejected",
      payload: {
        expense_id: "0194ebc4-94e8-7000-8000-000000000030",
        reason: "policy",
      },
    });

    const balances = replayFundEvents(FUND_ID, events);
    expect(balances.bankPaise).toBe(100000n);
    expect(balances.pendingSpendPaise).toBe(0n);
    expect(balances.availablePaise).toBe(100000n);
    expect(balances.donationsPaise).toBe(100000n);
    expect(balances.expensesPaise).toBe(0n);
  });

  it("does not double-count bank credits when donation.verified and bank.credit_seen share a bank_transaction_id", async () => {
    let prev: Event | null = null;
    const events: Event[] = [];
    const addEvent = async (raw: Parameters<typeof toEventInput>[0]) => {
      const input = toEventInput(raw);
      const ev = await makeNextEvent(prev, input);
      events.push(ev);
      prev = ev;
      return ev;
    };

    const bankTxId = "0194ebc4-94e8-7000-8000-000000000099";

    // 1. Donation pledged
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:00:00.000Z",
      type: "donation.pledged",
      payload: {
        donation_id: "0194ebc4-94e8-7000-8000-000000000010",
        amount_paise: 50000,
      },
    });

    // 2. Donation verified with bankTxId
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:01:00.000Z",
      type: "donation.verified",
      payload: {
        donation_id: "0194ebc4-94e8-7000-8000-000000000010",
        bank_transaction_id: bankTxId,
      },
    });

    // 3. Bank credit observed for the exact same transaction
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:02:00.000Z",
      type: "bank.credit_seen",
      payload: {
        bank_transaction_id: bankTxId,
        amount_paise: 50000,
      },
    });

    // Balances must be 50,000 paise, NOT 100,000 paise
    const balances = replayFundEvents(FUND_ID, events);
    expect(balances.bankPaise).toBe(50000n);
    expect(balances.donationsPaise).toBe(50000n);
    expect(balances.availablePaise).toBe(50000n);
  });

  it("expense reversal restores bank balance and reduces expenses", async () => {
    let prev: Event | null = null;
    const events: Event[] = [];
    const addEvent = async (raw: Parameters<typeof toEventInput>[0]) => {
      const input = toEventInput(raw);
      const ev = await makeNextEvent(prev, input);
      events.push(ev);
      prev = ev;
      return ev;
    };

    // 1. Initial donation: 100,000 paise
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:00:00.000Z",
      type: "donation.pledged",
      payload: { donation_id: "0194ebc4-94e8-7000-8000-000000000010", amount_paise: 100000 },
    });
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:01:00.000Z",
      type: "donation.verified",
      payload: {
        donation_id: "0194ebc4-94e8-7000-8000-000000000010",
        bank_transaction_id: "0194ebc4-94e8-7000-8000-000000000020",
      },
    });

    // 2. Submit & pay expense: 30,000 paise
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:02:00.000Z",
      type: "expense.submitted",
      payload: { expense_id: "0194ebc4-94e8-7000-8000-000000000030", amount_paise: 30000 },
    });
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:03:00.000Z",
      type: "expense.paid",
      payload: {
        expense_id: "0194ebc4-94e8-7000-8000-000000000030",
        bank_transaction_id: "0194ebc4-94e8-7000-8000-000000000040",
      },
    });

    const midBalances = replayFundEvents(FUND_ID, events);
    expect(midBalances.bankPaise).toBe(70000n);
    expect(midBalances.expensesPaise).toBe(30000n);

    // 3. Reverse expense
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:04:00.000Z",
      type: "expense.reversed",
      payload: {
        expense_id: "0194ebc4-94e8-7000-8000-000000000030",
        bank_transaction_id: "0194ebc4-94e8-7000-8000-000000000050",
      },
    });

    const finalBalances = replayFundEvents(FUND_ID, events);
    expect(finalBalances.bankPaise).toBe(100000n);
    expect(finalBalances.expensesPaise).toBe(0n);
    expect(finalBalances.availablePaise).toBe(100000n);
  });

  it("does not double-count bank debits when expense.paid precedes bank.debit_seen with same bank_transaction_id", async () => {
    let prev: Event | null = null;
    const events: Event[] = [];
    const addEvent = async (raw: Parameters<typeof toEventInput>[0]) => {
      const input = toEventInput(raw);
      const ev = await makeNextEvent(prev, input);
      events.push(ev);
      prev = ev;
      return ev;
    };

    const bankTxId = "0194ebc4-94e8-7000-8000-000000000099";

    // 1. Initial donation: 100,000 paise
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:00:00.000Z",
      type: "donation.pledged",
      payload: { donation_id: "0194ebc4-94e8-7000-8000-000000000010", amount_paise: 100000 },
    });
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:01:00.000Z",
      type: "donation.verified",
      payload: {
        donation_id: "0194ebc4-94e8-7000-8000-000000000010",
        bank_transaction_id: "0194ebc4-94e8-7000-8000-000000000020",
      },
    });

    // 2. Submit expense: 30,000 paise
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:02:00.000Z",
      type: "expense.submitted",
      payload: { expense_id: "0194ebc4-94e8-7000-8000-000000000030", amount_paise: 30000 },
    });

    // 3. Settle expense with bankTxId
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:03:00.000Z",
      type: "expense.paid",
      payload: {
        expense_id: "0194ebc4-94e8-7000-8000-000000000030",
        bank_transaction_id: bankTxId,
      },
    });

    // 4. Bank debit seen with the same bankTxId
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:04:00.000Z",
      type: "bank.debit_seen",
      payload: {
        bank_transaction_id: bankTxId,
        amount_paise: 30000,
      },
    });

    // Balance must be 70,000 paise and expenses 30,000 paise (not 40,000 / 60,000)
    const balances = replayFundEvents(FUND_ID, events);
    expect(balances.bankPaise).toBe(70000n);
    expect(balances.expensesPaise).toBe(30000n);
    expect(balances.availablePaise).toBe(70000n);
    expect(balances.donationsPaise).toBe(100000n);
  });

  it("does not double-count bank debits when bank.debit_seen precedes expense.paid with same bank_transaction_id", async () => {
    let prev: Event | null = null;
    const events: Event[] = [];
    const addEvent = async (raw: Parameters<typeof toEventInput>[0]) => {
      const input = toEventInput(raw);
      const ev = await makeNextEvent(prev, input);
      events.push(ev);
      prev = ev;
      return ev;
    };

    const bankTxId = "0194ebc4-94e8-7000-8000-000000000099";

    // 1. Initial donation: 100,000 paise
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:00:00.000Z",
      type: "donation.pledged",
      payload: { donation_id: "0194ebc4-94e8-7000-8000-000000000010", amount_paise: 100000 },
    });
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:01:00.000Z",
      type: "donation.verified",
      payload: {
        donation_id: "0194ebc4-94e8-7000-8000-000000000010",
        bank_transaction_id: "0194ebc4-94e8-7000-8000-000000000020",
      },
    });

    // 2. Submit expense: 30,000 paise
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:02:00.000Z",
      type: "expense.submitted",
      payload: { expense_id: "0194ebc4-94e8-7000-8000-000000000030", amount_paise: 30000 },
    });

    // 3. Bank debit seen FIRST
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:03:00.000Z",
      type: "bank.debit_seen",
      payload: {
        bank_transaction_id: bankTxId,
        amount_paise: 30000,
      },
    });

    // 4. Settle expense with the same bankTxId LATER
    await addEvent({
      fund_id: FUND_ID,
      actor: ACTOR,
      occurred_at: "2027-01-01T10:04:00.000Z",
      type: "expense.paid",
      payload: {
        expense_id: "0194ebc4-94e8-7000-8000-000000000030",
        bank_transaction_id: bankTxId,
      },
    });

    // Balance must be 70,000 paise and expenses 30,000 paise (not 40,000 / 60,000)
    const balances = replayFundEvents(FUND_ID, events);
    expect(balances.bankPaise).toBe(70000n);
    expect(balances.expensesPaise).toBe(30000n);
    expect(balances.availablePaise).toBe(70000n);
    expect(balances.donationsPaise).toBe(100000n);
  });
});

describe("replayFundEvents property-based tests (AC: replaying all events reproduces ledger balances)", () => {
  it("maintains zero-sum conservation and accurate balance derivation under random sequences", async () => {
    type Step =
      | { kind: "DONATE"; amount: number }
      | { kind: "RESERVE"; amount: number }
      | { kind: "SETTLE" }
      | { kind: "RELEASE" }
      | { kind: "REFUND" };

    const stepArb: fc.Arbitrary<Step> = fc.oneof(
      fc.record({
        kind: fc.constant("DONATE" as const),
        amount: fc.integer({ min: 100, max: 100_000 }),
      }),
      fc.record({
        kind: fc.constant("RESERVE" as const),
        amount: fc.integer({ min: 100, max: 50_000 }),
      }),
      fc.record({ kind: fc.constant("SETTLE" as const) }),
      fc.record({ kind: fc.constant("RELEASE" as const) }),
      fc.record({ kind: fc.constant("REFUND" as const) }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 20 }), async (steps) => {
        let prev: Event | null = null;
        const events: Event[] = [];
        let timeMs = 1735689600000; // 2025-01-01T00:00:00.000Z

        const activeHoldsList: { expenseId: string; amount: bigint }[] = [];
        const verifiedDonationsList: { donationId: string; amount: bigint }[] = [];
        let trackedAvailable = 0n;
        let idCounter = 1;

        const nextIso = () => {
          timeMs += 1000;
          return new Date(timeMs).toISOString();
        };

        const pushEvent = async (raw: Parameters<typeof toEventInput>[0]) => {
          const input = toEventInput(raw);
          const ev = await makeNextEvent(prev, input);
          events.push(ev);
          prev = ev;
          return ev;
        };

        for (const step of steps) {
          switch (step.kind) {
            case "DONATE": {
              const donationId = `0194ebc4-94e8-7000-8000-${String(idCounter++).padStart(12, "0")}`;
              const bankTxnId = `0194ebc4-94e8-7000-8000-${String(idCounter++).padStart(12, "0")}`;
              const amountBig = BigInt(step.amount);

              await pushEvent({
                fund_id: FUND_ID,
                actor: ACTOR,
                occurred_at: nextIso(),
                type: "donation.pledged",
                payload: {
                  donation_id: donationId,
                  amount_paise: step.amount,
                },
              });

              await pushEvent({
                fund_id: FUND_ID,
                actor: ACTOR,
                occurred_at: nextIso(),
                type: "donation.verified",
                payload: {
                  donation_id: donationId,
                  bank_transaction_id: bankTxnId,
                },
              });

              trackedAvailable += amountBig;
              verifiedDonationsList.push({ donationId, amount: amountBig });
              break;
            }

            case "RESERVE": {
              // Only reserve if available funds exist (enforcing AC: overspend impossible)
              const amountBig = BigInt(step.amount);
              if (amountBig > trackedAvailable) {
                // Cannot reserve more than available
                continue;
              }

              const expenseId = `0194ebc4-94e8-7000-8000-${String(idCounter++).padStart(12, "0")}`;
              await pushEvent({
                fund_id: FUND_ID,
                actor: ACTOR,
                occurred_at: nextIso(),
                type: "expense.submitted",
                payload: {
                  expense_id: expenseId,
                  amount_paise: step.amount,
                },
              });

              await pushEvent({
                fund_id: FUND_ID,
                actor: ACTOR,
                occurred_at: nextIso(),
                type: "expense.approved",
                payload: {
                  expense_id: expenseId,
                },
              });

              trackedAvailable -= amountBig;
              activeHoldsList.push({ expenseId, amount: amountBig });
              break;
            }

            case "SETTLE": {
              const hold = activeHoldsList.shift();
              if (!hold) continue;

              const bankTxnId = `0194ebc4-94e8-7000-8000-${String(idCounter++).padStart(12, "0")}`;
              await pushEvent({
                fund_id: FUND_ID,
                actor: ACTOR,
                occurred_at: nextIso(),
                type: "expense.paid",
                payload: {
                  expense_id: hold.expenseId,
                  bank_transaction_id: bankTxnId,
                },
              });
              break;
            }

            case "RELEASE": {
              const hold = activeHoldsList.shift();
              if (!hold) continue;

              await pushEvent({
                fund_id: FUND_ID,
                actor: ACTOR,
                occurred_at: nextIso(),
                type: "expense.rejected",
                payload: {
                  expense_id: hold.expenseId,
                  reason: "policy",
                },
              });

              trackedAvailable += hold.amount;
              break;
            }

            case "REFUND": {
              const donation = verifiedDonationsList.shift();
              if (!donation || donation.amount > trackedAvailable) {
                if (donation) verifiedDonationsList.unshift(donation);
                continue;
              }

              await pushEvent({
                fund_id: FUND_ID,
                actor: ACTOR,
                occurred_at: nextIso(),
                type: "donation.rejected",
                payload: {
                  donation_id: donation.donationId,
                  reason: "cancelled",
                },
              });

              trackedAvailable -= donation.amount;
              break;
            }
          }
        }

        if (events.length > 0) {
          // Cryptographic chain structure check
          const structure = await checkChainStructure(events);
          expect(structure.status).toBe("structure-consistent");

          const lastEvent = events[events.length - 1];
          if (!lastEvent) throw new Error("Expected event at tail");

          const head = chainHead({
            fundId: validFundId(FUND_ID),
            count: events.length,
            latestHash: lastEvent.hash,
          });
          const verification = await verifyChain(events, head);
          expect(verification.ok).toBe(true);
        }

        const balances = replayFundEvents(FUND_ID, events);

        // Core Accounting Invariants:
        expect(balances.bankPaise).toBeGreaterThanOrEqual(0n);
        expect(balances.pendingSpendPaise).toBeGreaterThanOrEqual(0n);
        expect(balances.availablePaise).toBeGreaterThanOrEqual(0n);
        expect(balances.donationsPaise).toBeGreaterThanOrEqual(0n);
        expect(balances.expensesPaise).toBeGreaterThanOrEqual(0n);

        // Available formula: available = bank - pending_spend
        expect(balances.bankPaise - balances.pendingSpendPaise).toBe(balances.availablePaise);

        // Conservation of money: bank balance + settled expenses = total verified donations
        expect(balances.bankPaise + balances.expensesPaise).toBe(balances.donationsPaise);
      }),
      { numRuns: 30 },
    );
  });
});
