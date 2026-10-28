import type { Sql } from "@yen/db";

export interface PledgeRow {
  id: string;
  fund_id: string;
  amount_paise: bigint | number | string;
  utr: string;
  donor_display_name?: string | null;
  status: string;
  created_at: Date | string;
}

export interface StateVerifier {
  getPledgeCount(fundId?: string): Promise<number>;
  ensureSchema(): Promise<void>;
  reset(fundId?: string): Promise<void>;
  verifyPledges(expectedCount: number, fundId?: string): Promise<StateVerificationResult>;
}

export interface StateVerificationResult {
  readonly passed: boolean;
  readonly beforeCount: number;
  readonly afterCount: number;
  readonly createdRows: number;
  readonly expectedRows: number;
  readonly discrepancy: number;
  readonly error?: string | undefined;
}

/**
 * In-memory state store and verifier used for standalone testing
 * when no PostgreSQL instance is configured.
 */
export class MemoryStateVerifier implements StateVerifier {
  private readonly pledges: PledgeRow[] = [];

  async ensureSchema(): Promise<void> {
    // No-op for in-memory store
  }

  async getPledgeCount(fundId?: string): Promise<number> {
    if (!fundId) return this.pledges.length;
    return this.pledges.filter((p) => p.fund_id === fundId).length;
  }

  async recordPledge(row: PledgeRow): Promise<void> {
    this.pledges.push(row);
  }

  async reset(fundId?: string): Promise<void> {
    if (!fundId) {
      this.pledges.length = 0;
    } else {
      const remaining = this.pledges.filter((p) => p.fund_id !== fundId);
      this.pledges.length = 0;
      this.pledges.push(...remaining);
    }
  }

  async verifyPledges(expectedCount: number, fundId?: string): Promise<StateVerificationResult> {
    const afterCount = await this.getPledgeCount(fundId);
    const discrepancy = afterCount - expectedCount;
    return {
      passed: afterCount === expectedCount,
      beforeCount: 0,
      afterCount,
      createdRows: afterCount,
      expectedRows: expectedCount,
      discrepancy,
    };
  }
}

/**
 * PostgreSQL state verifier querying the actual donation_pledges table.
 */
export class PostgresStateVerifier implements StateVerifier {
  constructor(private readonly sql: Sql) {}

  async ensureSchema(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS donation_pledges (
        id uuid PRIMARY KEY,
        fund_id uuid NOT NULL,
        amount_paise bigint NOT NULL CHECK (amount_paise > 0),
        utr text NOT NULL CHECK (utr ~ '^[0-9]{12}$'),
        donor_display_name text CHECK (char_length(donor_display_name) BETWEEN 1 AND 60),
        donor_contact text CHECK (char_length(donor_contact) BETWEEN 3 AND 254),
        status text NOT NULL DEFAULT 'pledged' CHECK (status IN ('pledged', 'verified', 'rejected')),
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        verified_at timestamptz,
        CONSTRAINT donation_pledges_utr_key UNIQUE (utr)
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS donation_pledges_fund_id_created_at_idx
        ON donation_pledges(fund_id, created_at DESC)
    `;
  }

  async getPledgeCount(fundId?: string): Promise<number> {
    if (fundId) {
      const rows = await this.sql<[{ count: string }]>`
        SELECT COUNT(*)::text as count FROM donation_pledges WHERE fund_id = ${fundId}::uuid
      `;
      return Number(rows[0]?.count ?? 0);
    }
    const rows = await this.sql<[{ count: string }]>`
      SELECT COUNT(*)::text as count FROM donation_pledges
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async reset(fundId?: string): Promise<void> {
    if (fundId) {
      await this.sql`DELETE FROM donation_pledges WHERE fund_id = ${fundId}::uuid`;
    } else {
      await this.sql`DELETE FROM donation_pledges`;
    }
  }

  async verifyPledges(expectedCount: number, fundId?: string): Promise<StateVerificationResult> {
    const afterCount = await this.getPledgeCount(fundId);
    const discrepancy = afterCount - expectedCount;
    return {
      passed: afterCount === expectedCount,
      beforeCount: 0,
      afterCount,
      createdRows: afterCount,
      expectedRows: expectedCount,
      discrepancy,
    };
  }
}
