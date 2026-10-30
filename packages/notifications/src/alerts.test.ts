import type { Event, EventHashHex, PseudonymId, payloadSchemas } from "@yen/eventlog";
import { type FundId, paise } from "@yen/shared";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { checkAlertTrigger, createAlertsForEvent } from "./alerts.js";
import type { FundSubscription } from "./subscriptions.js";

type ExpenseId = z.infer<(typeof payloadSchemas)["expense.submitted"]>["expense_id"];
type ObjectionId = z.infer<(typeof payloadSchemas)["expense.objection_raised"]>["objection_id"];

const FUND_ID = "123e4567-e89b-12d3-a456-426614174000" as FundId;
const ACTOR = "psn_00000000-0000-7000-8000-000000000000" as PseudonymId;
const HASH = "0000000000000000000000000000000000000000000000000000000000000001" as EventHashHex;
const EXPENSE_1 = "00000000-0000-7000-8000-000000000010" as ExpenseId;
const EXPENSE_LARGE = "00000000-0000-7000-8000-000000000020" as ExpenseId;
const EXPENSE_SMALL = "00000000-0000-7000-8000-000000000030" as ExpenseId;
const OBJECTION_1 = "00000000-0000-7000-8000-000000000040" as ObjectionId;

function mockEvent<T extends Event["type"]>(
  type: T,
  payload: Extract<Event, { type: T }>["payload"],
): Event {
  return {
    fund_id: FUND_ID,
    seq: 1,
    version: 1,
    type,
    actor: ACTOR,
    occurred_at: "2026-10-29T10:00:00.000Z",
    payload,
    prev_hash: HASH,
    hash: HASH,
  } as unknown as Event;
}

const mockSubscribers: FundSubscription[] = [
  {
    id: "00000000-0000-7000-8000-000000000001",
    fundId: FUND_ID,
    contact: "+919876543210",
    contactType: "phone",
    channel: "whatsapp",
    weeklySummary: true,
    instantAlerts: true,
    status: "active",
    unsubscribeToken: "token1",
    createdAt: new Date(),
    updatedAt: new Date(),
    unsubscribedAt: null,
  },
  {
    id: "00000000-0000-7000-8000-000000000002",
    fundId: FUND_ID,
    contact: "donor2@example.com",
    contactType: "email",
    channel: "email",
    weeklySummary: true,
    instantAlerts: false, // Opted out of instant alerts
    status: "active",
    unsubscribeToken: "token2",
    createdAt: new Date(),
    updatedAt: new Date(),
    unsubscribedAt: null,
  },
  {
    id: "00000000-0000-7000-8000-000000000003",
    fundId: FUND_ID,
    contact: "donor3@example.com",
    contactType: "email",
    channel: "email",
    weeklySummary: true,
    instantAlerts: true,
    status: "unsubscribed", // Unsubscribed donor
    unsubscribeToken: "token3",
    createdAt: new Date(),
    updatedAt: new Date(),
    unsubscribedAt: new Date(),
  },
];

describe("Instant Alerts Service", () => {
  it("triggers alert on expense.objection_raised", () => {
    const event = mockEvent("expense.objection_raised", {
      expense_id: EXPENSE_1,
      objection_id: OBJECTION_1,
    });
    const check = checkAlertTrigger(event);
    expect(check.shouldTrigger).toBe(true);
    expect(check.kind).toBe("objection");
    expect(check.expenseId).toBe(EXPENSE_1);
  });

  it("triggers alert on large expense exceeding threshold", () => {
    const largeEvent = mockEvent("expense.submitted", {
      expense_id: EXPENSE_LARGE,
      amount_paise: paise(1500000), // ₹15,000 (> ₹10,000 default threshold)
    });
    const check = checkAlertTrigger(largeEvent);
    expect(check.shouldTrigger).toBe(true);
    expect(check.kind).toBe("large_expense");
    expect(check.amountPaise).toBe(1500000);
  });

  it("does not trigger alert on regular smaller expense", () => {
    const smallEvent = mockEvent("expense.submitted", {
      expense_id: EXPENSE_SMALL,
      amount_paise: paise(50000), // ₹500
    });
    const check = checkAlertTrigger(smallEvent);
    expect(check.shouldTrigger).toBe(false);
  });

  it("enqueues alert notifications only to active subscribers who opted into instant alerts", async () => {
    const event = mockEvent("expense.objection_raised", {
      expense_id: EXPENSE_1,
      objection_id: OBJECTION_1,
    });

    const enqueued: Array<{
      id: unknown;
      fund_id: unknown;
      user_id: unknown;
      template_id: unknown;
      template_data: { unsubscribe_url?: string };
    }> = [];
    const mockTx = {
      unsafe: async (_query: string, params?: unknown[]) => {
        if (params) {
          const row = {
            id: params[0],
            fund_id: params[1],
            user_id: params[2],
            template_id: params[5],
            template_data: JSON.parse(params[6] as string),
          };
          enqueued.push(row);
          return [row];
        }
        return [];
      },
    };

    const results = await createAlertsForEvent(
      mockTx,
      event,
      "RoboCup 2026 Asia Fund",
      mockSubscribers,
      "https://yen.org.in",
    );

    // Only sub-1 should receive it (sub-2 opted out of alerts, sub-3 is unsubscribed)
    expect(results).toHaveLength(1);
    expect(enqueued).toHaveLength(1);
    const first = enqueued[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("Expected notification to be enqueued");
    expect(first.user_id).toBe("00000000-0000-7000-8000-000000000001");
    expect(first.template_id).toBe("objection_raised");
    expect(first.template_data.unsubscribe_url).toBe("https://yen.org.in/unsubscribe?token=token1");
  });
});
