import type { Sql } from "@yen/db";
import type { PublicFundDonation, PublicFundReadStore } from "./dependencies.js";

type DonationRow = {
  readonly id: string;
  readonly posted_at: string | Date;
  readonly amount_paise: string;
  readonly donor_display_name: string | null;
  readonly donor_name_choice: "full" | "initials" | "anonymous";
};

/** Read model for public totals. It only exposes reconciled bank credits, never pledges. */
export class PostgresPublicFundReadStore implements PublicFundReadStore {
  constructor(private readonly sql: Sql) {}

  async pledgedPaise(fundId: string): Promise<bigint> {
    const [row] = await this.sql<{ total: string }[]>`
      SELECT COALESCE(SUM(amount_paise), 0)::text AS total
      FROM donation_pledges WHERE fund_id = ${fundId} AND status = 'pledged'
    `;
    return BigInt(row?.total ?? "0");
  }

  async anchoredItems(fundId: string): Promise<ReadonlySet<string>> {
    const rows = await this.sql<{ id: string }[]>`
      SELECT DISTINCT CASE WHEN e.type = 'donation.verified' THEN bt.id::text
        ELSE ex.id::text END AS id
      FROM fund_events e
      JOIN bank_transactions bt ON bt.id::text = e.payload->>'bank_transaction_id'
        AND bt.fund_id = e.fund_id
      LEFT JOIN expenses ex ON ex.fund_id = e.fund_id AND ex.status = 'reconciled'
        AND ex.expense_data->>'bankTransactionId' = bt.id::text
      JOIN anchors a ON a.fund_id = e.fund_id AND e.seq BETWEEN a.from_seq AND a.to_seq
      WHERE e.fund_id = ${fundId} AND a.status = 'confirmed' AND a.tx_hash IS NOT NULL
        AND (
          (e.type = 'donation.verified' AND bt.type = 'credit'
            AND bt.reconciliation_status IN ('matched', 'manually_matched')
            AND bt.matched_pledge_id::text = e.payload->>'donation_id'
            AND EXISTS (SELECT 1 FROM donation_pledges dp
              WHERE dp.id = bt.matched_pledge_id AND dp.fund_id = bt.fund_id AND dp.status = 'verified'))
          OR (e.type = 'bank.debit_seen' AND bt.type = 'debit' AND ex.id IS NOT NULL
            AND ex.expense_data->>'amountPaise' = bt.amount_paise::text)
        )
    `;
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
