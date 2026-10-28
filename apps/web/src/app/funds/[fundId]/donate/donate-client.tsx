"use client";

import {
  DonationForm,
  type DonationOutcome,
  type DonationPledge,
} from "../../../../components/donation-form";

export interface DonateClientProps {
  fundId: string;
  fundTitle: string;
  upiVpa: string;
  upiPayeeName: string;
  apiUrl: string;
}

export function DonateClient({
  fundId,
  fundTitle,
  upiVpa,
  upiPayeeName,
  apiUrl,
}: DonateClientProps) {
  async function submit(pledge: DonationPledge): Promise<DonationOutcome> {
    const response = await fetch(
      `${apiUrl}/v1/funds/${encodeURIComponent(fundId)}/donations/pledge`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          amountPaise: String(pledge.amountPaise),
          utr: pledge.utr,
          ...(pledge.donorName === undefined ? {} : { donorName: pledge.donorName }),
          ...(pledge.donorContact === undefined ? {} : { donorContact: pledge.donorContact }),
        }),
      },
    );
    if (response.ok) return "pledged";
    const body = await response.json().catch(() => null);
    if (body?.error?.code === "donation_utr_claimed") return "duplicate_utr";
    return "failed";
  }

  return (
    <DonationForm
      fundTitle={fundTitle}
      upiVpa={upiVpa}
      upiPayeeName={upiPayeeName}
      onSubmit={submit}
    />
  );
}
