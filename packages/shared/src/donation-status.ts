import * as z from "zod";

export const donationStatusSchema = z.enum(["pledged", "verified", "rejected", "refunded"]);
export type DonationStatus = z.infer<typeof donationStatusSchema>;

export function isOutstandingPledge(status: DonationStatus): boolean {
  switch (status) {
    case "pledged":
      return true;
    case "verified":
    case "rejected":
    case "refunded":
      return false;
  }
  const exhaustive: never = status;
  throw new Error(`Unknown donation status: ${exhaustive}`);
}
