import { paise } from "@yen/shared";
import type { PartnerWebhookPayload } from "../partner-schema.js";

export function createSandboxWebhook(overrides: {
  fundId: string;
  bankReference: string;
  amountPaise: number;
  utr?: string | undefined;
  narration?: string | undefined;
  postedAt?: string | undefined;
}): PartnerWebhookPayload {
  return {
    event: "virtual_account.credited",
    timestamp: new Date().toISOString(),
    data: {
      fund_id: overrides.fundId,
      bank_reference: overrides.bankReference,
      amount_paise: paise(overrides.amountPaise),
      type: "credit",
      posted_at: overrides.postedAt ?? "2026-10-28T14:30:00.000Z",
      utr: overrides.utr,
      narration:
        overrides.narration ?? (overrides.utr ? `UPI/CR/${overrides.utr}/DONATION` : undefined),
      counterparty: {
        vpa: "donor@okhdfcbank",
        name: "Test Donor",
      },
    },
  };
}
