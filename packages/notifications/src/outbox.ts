import type { NotificationOutboxRow } from "@yen/db";
import { uuidv7 } from "@yen/db";
import type { Event } from "@yen/eventlog";
import type { UserId } from "@yen/shared";
import { type EnqueueNotificationInput, enqueueNotificationInputSchema } from "./types.js";

export type SqlTransaction = {
  unsafe: (query: string, params?: unknown[]) => Promise<unknown[]>;
};

export interface EventNotificationRecipient {
  userId: UserId;
  fundTitle: string;
}

export function buildNotificationIdempotencyKey(
  fundId: string,
  userId: string,
  eventType: string,
  entityId: string,
): string {
  return `notify:${fundId}:${userId}:${eventType}:${entityId}`;
}

/**
 * Enqueues a notification row in the database outbox using the supplied client/transaction.
 * If a row with the same idempotency_key already exists, the insert is deduplicated.
 */
export async function enqueueNotification(
  tx: SqlTransaction,
  input: EnqueueNotificationInput,
): Promise<NotificationOutboxRow | null> {
  const validated = enqueueNotificationInputSchema.parse(input);
  const id = uuidv7();
  const now = new Date();

  // Deduplicated insert: ON CONFLICT (idempotency_key) DO NOTHING
  const rows = (await tx.unsafe(
    `INSERT INTO notification_outbox (
      id, fund_id, user_id, event_id, idempotency_key, template_id,
      template_data, preferred_channel, status, attempts, max_attempts,
      next_attempt_at, cost_paise, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, 'pending', 0, $9, $10, 0, $11, $12
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *`,
    [
      id,
      validated.fund_id,
      validated.user_id,
      validated.event_id ?? null,
      validated.idempotency_key,
      validated.template_id,
      JSON.stringify(validated.template_data),
      validated.preferred_channel ?? "whatsapp",
      validated.max_attempts ?? 3,
      now,
      now,
      now,
    ],
  )) as NotificationOutboxRow[];

  if (rows && rows.length > 0 && rows[0]) {
    return rows[0];
  }

  // Row already existed (deduplicated)
  const existing = (await tx.unsafe(
    `SELECT * FROM notification_outbox WHERE idempotency_key = $1`,
    [validated.idempotency_key],
  )) as NotificationOutboxRow[];

  return existing[0] ?? null;
}

/**
 * Creates notification outbox rows for domain events in the SAME database transaction.
 */
export async function createNotificationsForEvent(
  tx: SqlTransaction,
  event: Event,
  recipients: EventNotificationRecipient[],
): Promise<NotificationOutboxRow[]> {
  const results: NotificationOutboxRow[] = [];

  for (const recipient of recipients) {
    let input: EnqueueNotificationInput | null = null;

    switch (event.type) {
      case "expense.submitted": {
        const payload = event.payload;
        input = {
          fund_id: event.fund_id,
          user_id: recipient.userId,
          event_id: event.hash,
          idempotency_key: buildNotificationIdempotencyKey(
            event.fund_id,
            recipient.userId,
            event.type,
            payload.expense_id,
          ),
          template_id: "approval_needed",
          template_data: {
            fund_title: recipient.fundTitle,
            expense_id: payload.expense_id,
            amount_paise: payload.amount_paise,
            requester_pseudonym: event.actor,
          },
        };
        break;
      }

      case "expense.approved": {
        const payload = event.payload;
        input = {
          fund_id: event.fund_id,
          user_id: recipient.userId,
          event_id: event.hash,
          idempotency_key: buildNotificationIdempotencyKey(
            event.fund_id,
            recipient.userId,
            event.type,
            payload.expense_id,
          ),
          template_id: "approved_rejected",
          template_data: {
            fund_title: recipient.fundTitle,
            expense_id: payload.expense_id,
            decision: "approved",
          },
        };
        break;
      }

      case "expense.rejected": {
        const payload = event.payload;
        input = {
          fund_id: event.fund_id,
          user_id: recipient.userId,
          event_id: event.hash,
          idempotency_key: buildNotificationIdempotencyKey(
            event.fund_id,
            recipient.userId,
            event.type,
            payload.expense_id,
          ),
          template_id: "approved_rejected",
          template_data: {
            fund_title: recipient.fundTitle,
            expense_id: payload.expense_id,
            decision: "rejected",
            reason: payload.reason,
          },
        };
        break;
      }

      case "donation.verified": {
        const payload = event.payload;
        input = {
          fund_id: event.fund_id,
          user_id: recipient.userId,
          event_id: event.hash,
          idempotency_key: buildNotificationIdempotencyKey(
            event.fund_id,
            recipient.userId,
            event.type,
            payload.donation_id,
          ),
          template_id: "donation_received",
          template_data: {
            fund_title: recipient.fundTitle,
            donation_id: payload.donation_id,
            amount_paise: 0, // In verified event, bank amount or previous pledged amount is used
            donor_pseudonym: event.actor,
          },
        };
        break;
      }

      case "donation.pledged": {
        const payload = event.payload;
        input = {
          fund_id: event.fund_id,
          user_id: recipient.userId,
          event_id: event.hash,
          idempotency_key: buildNotificationIdempotencyKey(
            event.fund_id,
            recipient.userId,
            event.type,
            payload.donation_id,
          ),
          template_id: "donation_received",
          template_data: {
            fund_title: recipient.fundTitle,
            donation_id: payload.donation_id,
            amount_paise: payload.amount_paise,
            donor_pseudonym: event.actor,
          },
        };
        break;
      }

      case "expense.objection_raised": {
        const payload = event.payload;
        input = {
          fund_id: event.fund_id,
          user_id: recipient.userId,
          event_id: event.hash,
          idempotency_key: buildNotificationIdempotencyKey(
            event.fund_id,
            recipient.userId,
            event.type,
            payload.objection_id,
          ),
          template_id: "objection_raised",
          template_data: {
            fund_title: recipient.fundTitle,
            expense_id: payload.expense_id,
            objection_id: payload.objection_id,
          },
        };
        break;
      }

      default:
        // Other events do not trigger outbox notifications
        break;
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
