import type { NotificationOutboxRow } from "@yen/db";
import type { Event } from "@yen/eventlog";
import { type Paise, paise } from "@yen/shared";
import {
  buildNotificationIdempotencyKey,
  enqueueNotification,
  type SqlTransaction,
} from "./outbox.js";
import { buildUnsubscribeUrl, type FundSubscription } from "./subscriptions.js";
import type { EnqueueNotificationInput } from "./types.js";

export const DEFAULT_LARGE_EXPENSE_THRESHOLD_PAISE = 1_000_000; // ₹10,000

export type AlertTriggerKind = "objection" | "large_expense";

export interface AlertTriggerCheck {
  readonly shouldTrigger: boolean;
  readonly kind?: AlertTriggerKind | undefined;
  readonly amountPaise?: Paise | undefined;
  readonly expenseId?: string | undefined;
}

export function checkAlertTrigger(
  event: Event,
  largeExpenseThresholdPaise: number = DEFAULT_LARGE_EXPENSE_THRESHOLD_PAISE,
): AlertTriggerCheck {
  if (event.type === "expense.objection_raised") {
    return {
      shouldTrigger: true,
      kind: "objection",
      expenseId: event.payload.expense_id,
    };
  }

  if (event.type === "expense.submitted") {
    const amount = Number(event.payload.amount_paise);
    if (amount >= largeExpenseThresholdPaise) {
      return {
        shouldTrigger: true,
        kind: "large_expense",
        amountPaise: paise(amount),
        expenseId: event.payload.expense_id,
      };
    }
  }

  return { shouldTrigger: false };
}

export async function createAlertsForEvent(
  tx: SqlTransaction,
  event: Event,
  fundTitle: string,
  subscribers: readonly FundSubscription[],
  baseUrl: string,
  options?: {
    largeExpenseThresholdPaise?: number;
    descriptionMap?: Map<string, string> | Record<string, string>;
  },
): Promise<NotificationOutboxRow[]> {
  const trigger = checkAlertTrigger(event, options?.largeExpenseThresholdPaise);
  if (!trigger.shouldTrigger || !trigger.kind) {
    return [];
  }

  const results: NotificationOutboxRow[] = [];
  const descMap =
    options?.descriptionMap instanceof Map
      ? options.descriptionMap
      : new Map(Object.entries(options?.descriptionMap ?? {}));

  // Filter subscribers to active recipients who opted into instant alerts
  const activeRecipients = subscribers.filter(
    (sub) => sub.status === "active" && sub.instantAlerts,
  );

  for (const sub of activeRecipients) {
    const unsubscribeUrl = buildUnsubscribeUrl(baseUrl, sub.unsubscribeToken);
    let input: EnqueueNotificationInput | null = null;

    if (trigger.kind === "objection") {
      const payload = event.payload as { expense_id: string; objection_id: string };
      input = {
        fund_id: event.fund_id,
        user_id: sub.id, // Using subscription ID as recipient identifier for tracking
        event_id: event.hash,
        idempotency_key: buildNotificationIdempotencyKey(
          event.fund_id,
          sub.id,
          "alert.objection",
          payload.objection_id,
        ),
        template_id: "objection_raised",
        template_data: {
          fund_title: fundTitle,
          expense_id: payload.expense_id,
          objection_id: payload.objection_id,
          unsubscribe_url: unsubscribeUrl,
        },
        preferred_channel: sub.channel,
      };
    } else if (trigger.kind === "large_expense" && trigger.expenseId && trigger.amountPaise) {
      const description = descMap.get(trigger.expenseId) ?? "Large community expense";
      input = {
        fund_id: event.fund_id,
        user_id: sub.id,
        event_id: event.hash,
        idempotency_key: buildNotificationIdempotencyKey(
          event.fund_id,
          sub.id,
          "alert.large_expense",
          trigger.expenseId,
        ),
        template_id: "large_expense_alert",
        template_data: {
          fund_title: fundTitle,
          expense_id: trigger.expenseId,
          amount_paise: trigger.amountPaise,
          description,
          unsubscribe_url: unsubscribeUrl,
        },
        preferred_channel: sub.channel,
      };
    }

    if (input) {
      const enqueued = await enqueueNotification(tx, input);
      if (enqueued) {
        results.push(enqueued);
      }
    }
  }

  return results;
}
