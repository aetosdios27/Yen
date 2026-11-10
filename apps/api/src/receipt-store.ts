import type { Sql } from "@yen/db";
import type { DonationStatus } from "@yen/shared";
import type { FundStore } from "./dependencies.js";

export interface ReceiptRecord {
  readonly donationId: string;
  readonly fundId: string;
  readonly fundTitle: string;
  readonly amountPaise: number;
  readonly utr: string;
  readonly donorDisplayName?: string | null | undefined;
  readonly donorNameChoice?: "full" | "initials" | "anonymous" | undefined;
  readonly status: DonationStatus;
  readonly createdAt: string;
  readonly refundedAt?: string | null | undefined;
  readonly verifiedAt?: string | null | undefined;
  readonly proofUrl?: string | undefined;
  readonly onChainRoot?: string | undefined;
  readonly onChainTxHash?: string | undefined;
}

export interface ReceiptStore {
  getReceipt(receiptId: string): Promise<ReceiptRecord | null>;
  addReceipt?(record: ReceiptRecord): Promise<void>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function redactDonorDisplayName(
  rawName: string | null | undefined,
  choice: "full" | "initials" | "anonymous" | null | undefined,
): string | undefined {
  if (!rawName?.trim()) return undefined;
  const trimmed = rawName.trim();
  if (choice === "anonymous") return undefined;
  if (choice === "full") return trimmed;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts.map((part) => `${part[0]?.toUpperCase()}.`).join(" ") || undefined;
}

export class PostgresReceiptStore implements ReceiptStore {
  constructor(
    private readonly sql: Sql,
    private readonly fundStore?: FundStore,
  ) {}

  async getReceipt(receiptId: string): Promise<ReceiptRecord | null> {
    if (!UUID_REGEX.test(receiptId)) {
      return null;
    }

    interface DonationPledgeRow {
      id: string;
      fund_id: string;
      amount_paise: string | number | bigint;
      utr: string;
      donor_display_name: string | null;
      donor_name_choice: "full" | "initials" | "anonymous" | null;
      status: DonationStatus;
      created_at: Date | string;
      verified_at: Date | string | null;
    }

    const rows = await this.sql<DonationPledgeRow[]>`
      SELECT id, fund_id, amount_paise, utr, donor_display_name, donor_name_choice, status, created_at, verified_at
      FROM donation_pledges
      WHERE id = ${receiptId}::uuid
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      return null;
    }

    const [refund] = await this.sql<{ occurred_at: Date }[]>`
      SELECT e.occurred_at FROM fund_events e
      WHERE e.fund_id = ${row.fund_id} AND e.type = 'donation.rejected'
        AND e.payload->>'donation_id' = ${row.id}
        AND EXISTS (SELECT 1 FROM fund_events v WHERE v.fund_id = e.fund_id
          AND v.type = 'donation.verified' AND v.payload->>'donation_id' = ${row.id} AND v.seq < e.seq)
      ORDER BY e.seq LIMIT 1`;
    const fund = await this.fundStore?.get(row.fund_id);
    const fundTitle = fund?.fund.name ?? "Community Fund";
    const createdAt =
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString();
    const verifiedAt = row.verified_at
      ? row.verified_at instanceof Date
        ? row.verified_at.toISOString()
        : new Date(row.verified_at).toISOString()
      : null;

    const donorNameChoice = row.donor_name_choice ?? "initials";
    const donorDisplayName = redactDonorDisplayName(row.donor_display_name, donorNameChoice);

    return {
      donationId: row.id,
      fundId: row.fund_id,
      fundTitle,
      amountPaise: Number(row.amount_paise),
      utr: row.utr,
      ...(donorDisplayName ? { donorDisplayName } : {}),
      donorNameChoice,
      status: row.status,
      createdAt,
      verifiedAt,
      ...(refund ? { refundedAt: new Date(refund.occurred_at).toISOString() } : {}),
      proofUrl: `/verify?fundId=${encodeURIComponent(row.fund_id)}&recordId=${encodeURIComponent(row.id)}`,
    };
  }
}

export class MemoryReceiptStore implements ReceiptStore {
  private readonly receiptsById = new Map<string, ReceiptRecord>();

  async getReceipt(receiptId: string): Promise<ReceiptRecord | null> {
    if (!UUID_REGEX.test(receiptId)) {
      return null;
    }
    return this.receiptsById.get(receiptId) ?? null;
  }

  async addReceipt(record: ReceiptRecord): Promise<void> {
    const donorNameChoice = record.donorNameChoice ?? "initials";
    const donorDisplayName = redactDonorDisplayName(record.donorDisplayName, donorNameChoice);
    this.receiptsById.set(record.donationId, {
      ...record,
      donorDisplayName,
      donorNameChoice,
    });
  }
}
