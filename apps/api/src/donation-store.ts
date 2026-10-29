import { type Sql, setGuestDisplayName } from "@yen/db";
import { pledgeDonation } from "@yen/ledger";
import { paise } from "@yen/shared";
import type {
  DonationPledgeOutcome,
  DonationPledgeRequest,
  DonationPledgeStore,
} from "./dependencies.js";

/**
 * Writes the pledge row, the receivable posting and the `donation.pledged`
 * event in one transaction, so a retry can never double-count a donation.
 */
export class PostgresDonationPledgeStore implements DonationPledgeStore {
  constructor(private readonly sql: Sql) {}

  async pledge(request: DonationPledgeRequest): Promise<DonationPledgeOutcome> {
    return this.sql.begin(async (tx) => {
      const result = await pledgeDonation(tx, {
        fundId: request.fundId,
        amount: paise(request.amountPaise),
        utr: request.utr,
        ...(request.donorName === undefined ? {} : { donorDisplayName: request.donorName }),
        ...(request.donorContact === undefined ? {} : { donorContact: request.donorContact }),
        donorNameChoice: request.donorNameChoice ?? "initials",
      });
      if (
        result.kind === "pledged" &&
        request.donorName !== undefined &&
        request.donorContact !== undefined
      ) {
        await setGuestDisplayName(tx, {
          fundId: request.fundId,
          contact: request.donorContact,
          displayName: request.donorName,
        });
      }
      return result.kind === "pledged"
        ? { kind: "pledged" as const, donationId: result.donationId }
        : { kind: "duplicate_utr" as const };
    });
  }
}
