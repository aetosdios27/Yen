import type { Event, EventHashHex, PseudonymId } from "@yen/eventlog";
import { type FundId, paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import { generateWeeklySummaryFromEvents } from "./weekly-summary.js";

const FUND_ID = "123e4567-e89b-12d3-a456-426614174000" as FundId;
const ACTOR = "psn_00000000-0000-7000-8000-000000000000" as PseudonymId;
const HASH = "0000000000000000000000000000000000000000000000000000000000000001" as EventHashHex;

function mockEvent(
  type: Event["type"],
  payload: Record<string, unknown>,
  occurredAt: string,
): Event {
  return {
    fund_id: FUND_ID,
    seq: 1,
    version: 1,
    type,
    actor: ACTOR,
    occurred_at: occurredAt,
    payload,
    prev_hash: HASH,
    hash: HASH,
  } as unknown as Event;
}

describe("Event-Sourced Weekly Summary Generator", () => {
  it("computes spending breakdown directly from events: '₹12,400 spent this week: stage ₹8,000, sound ₹4,400'", () => {
    const events: Event[] = [
      mockEvent(
        "expense.submitted",
        { expense_id: "exp-1", amount_paise: paise(800000) },
        "2026-10-25T10:00:00.000Z",
      ),
      mockEvent(
        "expense.submitted",
        { expense_id: "exp-2", amount_paise: paise(440000) },
        "2026-10-26T14:30:00.000Z",
      ),
      mockEvent(
        "donation.pledged",
        { donation_id: "don-1", amount_paise: paise(500000) },
        "2026-10-27T09:00:00.000Z",
      ),
    ];

    const categoryMap = new Map([
      ["exp-1", "stage"],
      ["exp-2", "sound"],
    ]);

    const result = generateWeeklySummaryFromEvents(
      FUND_ID,
      "RoboCup 2026 Asia Fund",
      events,
      "2026-10-23T00:00:00.000Z",
      "2026-10-30T00:00:00.000Z",
      {
        expenseCategoryMap: categoryMap,
        unsubscribeUrl: "https://yen.org.in/unsubscribe?token=abc123token",
      },
    );

    expect(result.expensesCount).toBe(2);
    expect(result.totalExpensesPaise).toBe(1240000); // ₹12,400.00
    expect(result.donationsCount).toBe(1);
    expect(result.totalDonationsPaise).toBe(500000);

    // Matches the required exact copy structure:
    expect(result.messageEn).toContain(
      "₹12,400.00 spent this week: stage ₹8,000.00, sound ₹4,400.00",
    );
    expect(result.messageEn).toContain(
      "Unsubscribe with one tap: https://yen.org.in/unsubscribe?token=abc123token",
    );

    expect(result.messageHi).toContain(
      "इस सप्ताह ₹12,400.00 खर्च हुए: stage ₹8,000.00, sound ₹4,400.00",
    );
    expect(result.messageHi).toContain(
      "सदस्यता समाप्त करने के लिए एक बार टैप करें: https://yen.org.in/unsubscribe?token=abc123token",
    );
  });

  it("excludes rejected or expired expenses from the total", () => {
    const events: Event[] = [
      mockEvent(
        "expense.submitted",
        { expense_id: "exp-1", amount_paise: paise(500000) },
        "2026-10-25T10:00:00.000Z",
      ),
      mockEvent(
        "expense.rejected",
        { expense_id: "exp-1", reason: "policy" },
        "2026-10-26T10:00:00.000Z",
      ),
      mockEvent(
        "expense.submitted",
        { expense_id: "exp-2", amount_paise: paise(300000) },
        "2026-10-27T10:00:00.000Z",
      ),
    ];

    const result = generateWeeklySummaryFromEvents(
      FUND_ID,
      "RoboCup 2026 Asia Fund",
      events,
      "2026-10-23T00:00:00.000Z",
      "2026-10-30T00:00:00.000Z",
    );

    expect(result.expensesCount).toBe(1);
    expect(result.totalExpensesPaise).toBe(300000);
  });

  it("filters events strictly within the period boundaries", () => {
    const events: Event[] = [
      // Before period
      mockEvent(
        "expense.submitted",
        { expense_id: "exp-old", amount_paise: paise(900000) },
        "2026-10-01T10:00:00.000Z",
      ),
      // Inside period
      mockEvent(
        "expense.submitted",
        { expense_id: "exp-in", amount_paise: paise(200000) },
        "2026-10-25T10:00:00.000Z",
      ),
      // After period
      mockEvent(
        "expense.submitted",
        { expense_id: "exp-future", amount_paise: paise(800000) },
        "2026-11-05T10:00:00.000Z",
      ),
    ];

    const result = generateWeeklySummaryFromEvents(
      FUND_ID,
      "RoboCup 2026 Asia Fund",
      events,
      "2026-10-20T00:00:00.000Z",
      "2026-10-27T00:00:00.000Z",
    );

    expect(result.expensesCount).toBe(1);
    expect(result.totalExpensesPaise).toBe(200000);
  });
});
