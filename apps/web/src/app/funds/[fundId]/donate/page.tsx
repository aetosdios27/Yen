import { notFound } from "next/navigation";
import * as z from "zod";
import { DonateClient } from "./donate-client";

// The payee details come from the API on every request, so the build needs no env.
export const dynamic = "force-dynamic";

const donationDetailsSchema = z.object({
  fundId: z.uuid(),
  title: z.string(),
  upiVpa: z.string(),
  upiPayeeName: z.string(),
});

async function fetchDonationDetails(apiUrl: string, fundId: string) {
  const response = await fetch(
    `${apiUrl}/v1/funds/${encodeURIComponent(fundId)}/donation-details`,
    { cache: "no-store" },
  );
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Donation details are unavailable right now");
  return donationDetailsSchema.parse(await response.json());
}

export default async function DonatePage({ params }: { params: Promise<{ fundId: string }> }) {
  const { fundId } = await params;
  const { env } = await import("../../../../env");
  const details = await fetchDonationDetails(env.NEXT_PUBLIC_API_URL, fundId);

  return (
    <DonateClient
      fundId={details.fundId}
      fundTitle={details.title}
      upiVpa={details.upiVpa}
      upiPayeeName={details.upiPayeeName}
      apiUrl={env.NEXT_PUBLIC_API_URL}
    />
  );
}
