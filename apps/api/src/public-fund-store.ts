import { publicAnchoredItemsSql, publicPledgedPaiseSql, type Sql } from "@yen/db";
import type { PublicFundDonation, PublicFundReadStore } from "./dependencies.js";

type DonationRow = {
  readonly refund_seq: string | null;
  readonly refunded_at: Date | null;
  readonly refund_anchored: boolean;
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
        dp.donor_display_name, dp.donor_name_choice,
        r.journal_id AS refund_seq, r.occurred_at AS refunded_at,
        EXISTS (SELECT 1 FROM anchors a WHERE a.fund_id = bt.fund_id AND a.status = 'confirmed'
          AND a.tx_hash IS NOT NULL AND r.seq BETWEEN a.from_seq AND a.to_seq) AS refund_anchored
      FROM bank_transactions bt
      JOIN donation_pledges dp ON dp.id = bt.matched_pledge_id
      LEFT JOIN LATERAL (
        SELECT e.seq, e.occurred_at, (SELECT j.id::text FROM konto_journals j
          WHERE j.metadata->>'donationId' = dp.id::text AND j.metadata->>'fundId' = dp.fund_id::text
            AND j.metadata ? 'refundReason' LIMIT 1) AS journal_id FROM fund_events e
        WHERE e.fund_id = dp.fund_id AND e.type = 'donation.rejected'
          AND e.payload->>'donation_id' = dp.id::text
          AND EXISTS (SELECT 1 FROM fund_events v WHERE v.fund_id = e.fund_id
            AND v.type = 'donation.verified' AND v.payload->>'donation_id' = dp.id::text AND v.seq < e.seq)
        ORDER BY e.seq LIMIT 1
      ) r ON dp.status = 'refunded'
      WHERE bt.fund_id = ${fundId}
        AND bt.type = 'credit'
        AND bt.reconciliation_status IN ('matched', 'manually_matched')
        AND dp.status IN ('verified', 'refunded') AND dp.fund_id = bt.fund_id
      ORDER BY bt.posted_at ASC, bt.id ASC
    `;
    return rows.map((row) => ({
      id: row.id,
      ...(row.refund_seq && row.refunded_at
        ? {
            refund: {
              id: row.refund_seq,
              occurredAt: new Date(row.refunded_at).toISOString(),
              anchored: row.refund_anchored,
            },
          }
        : {}),
      occurredAt: new Date(row.posted_at).toISOString(),
      amountPaise: BigInt(row.amount_paise),
      donorDisplayName: row.donor_display_name,
      donorNameChoice: row.donor_name_choice,
    }));
  }
}
