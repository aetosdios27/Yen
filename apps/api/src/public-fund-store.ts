import { publicAnchoredItemsSql, publicPledgedPaiseSql, type Sql } from "@yen/db";
import type { PublicFundDonation, PublicFundReadStore } from "./dependencies.js";

type DonationRow = {
  readonly id: string;
  readonly posted_at: string | Date;
  readonly amount_paise: string;
  readonly donor_display_name: string | null;
  readonly donor_name_choice: "full" | "initials" | "anonymous";
};

/** Keeps outstanding pledges separate from bank-matched money in public reads. */
export class PostgresPublicFundReadStore implements PublicFundReadStore {
  constructor(private readonly sql: Sql) {}

  async pledgedPaise(fundId: string): Promise<bigint> {
    const [row] = await this.sql.unsafe<{ total: string }[]>(publicPledgedPaiseSql, [fundId]);
    return BigInt(row?.total ?? "0");
  }

  async anchoredItems(fundId: string): Promise<ReadonlySet<string>> {
    const rows = await this.sql.unsafe<{ id: string }[]>(publicAnchoredItemsSql, [fundId]);
    return new Set(rows.map((row) => row.id));
  }

  async donations(fundId: string): Promise<readonly PublicFundDonation[]> {
    const rows = await this.sql<DonationRow[]>`
      SELECT bt.id, bt.posted_at, bt.amount_paise::text,
        dp.donor_display_name, dp.donor_name_choice
      FROM bank_transactions bt
      JOIN donation_pledges dp ON dp.id = bt.matched_pledge_id
      WHERE bt.fund_id = ${fundId}
        AND bt.type = 'credit'
        AND bt.reconciliation_status IN ('matched', 'manually_matched')
        AND dp.status = 'verified' AND dp.fund_id = bt.fund_id
      ORDER BY bt.posted_at ASC, bt.id ASC
    `;
    return rows.map((row) => ({
      id: row.id,
      occurredAt: new Date(row.posted_at).toISOString(),
      amountPaise: BigInt(row.amount_paise),
      donorDisplayName: row.donor_display_name,
      donorNameChoice: row.donor_name_choice,
    }));
  }
}
