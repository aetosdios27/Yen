import { createHash } from "node:crypto";
import type { Event } from "@yen/eventlog";
import {
  type Paise,
  type PseudonymId,
  paise,
  parseFundId,
  parseOrgId,
  parsePseudonymId,
} from "@yen/shared";
import type { Sql } from "./client.js";
import { type AppendEventInput, appendEvent } from "./events.js";
import { migrate } from "./migrate.js";

export interface DevSeedUser {
  readonly id: string;
  readonly phone: string;
  readonly displayName: string;
  readonly locale: string;
  readonly role: "treasurer" | "approver" | "member";
  readonly pseudonymId: string;
  readonly actor: `psn_${string}`;
  readonly sessionToken: string;
}

export interface DevSeedExpense {
  readonly id: string;
  readonly fundId: string;
  readonly requesterId: string;
  readonly amountPaise: Paise;
  readonly description: string;
  readonly recipientRef: string;
  readonly status: "approved" | "submitted" | "paid";
  readonly evidenceId?: string;
  readonly contentSha256?: string;
  readonly bankTransactionId?: string;
  readonly utr?: string;
}

export interface DevSeedResult {
  readonly org: {
    readonly id: string;
    readonly name: string;
    readonly legalForm: string;
    readonly ownerId: string;
  };
  readonly fund: {
    readonly id: string;
    readonly orgId: string;
    readonly title: string;
    readonly targetPaise: bigint;
    readonly visibilityTier: "public";
    readonly upiVpa: string;
    readonly upiPayeeName: string;
    readonly status: "active";
  };
  readonly users: readonly DevSeedUser[];
  readonly expenses: readonly DevSeedExpense[];
  readonly ledger: {
    readonly initialDonationsPaise: Paise;
    readonly paidExpensesPaise: Paise;
    readonly currentBalancePaise: Paise;
    readonly isZeroSum: boolean;
  };
  readonly eventCount: number;
}

export const SEED_CONSTANTS = {
  orgId: "01940000-0000-7000-8000-000000000001",
  fundId: "01940000-0000-7000-8000-000000000002",
  treasurerUserId: "01940000-0000-7000-8000-000000000010",
  approver1UserId: "01940000-0000-7000-8000-000000000011",
  approver2UserId: "01940000-0000-7000-8000-000000000012",
  donor1UserId: "01940000-0000-7000-8000-000000000013",
  donor2UserId: "01940000-0000-7000-8000-000000000014",
  donor3UserId: "01940000-0000-7000-8000-000000000015",
  treasurerPseudonymId: "01940000-0000-7000-8000-000000000020",
  approver1PseudonymId: "01940000-0000-7000-8000-000000000021",
  approver2PseudonymId: "01940000-0000-7000-8000-000000000022",
  donor1PseudonymId: "01940000-0000-7000-8000-000000000023",
  donor2PseudonymId: "01940000-0000-7000-8000-000000000024",
  donor3PseudonymId: "01940000-0000-7000-8000-000000000025",
  expense1ApprovedId: "01940000-0000-7000-8000-000000000061",
  expense2PendingId: "01940000-0000-7000-8000-000000000062",
  expense3PaidId: "01940000-0000-7000-8000-000000000063",
  evidence1Id: "01940000-0000-7000-8000-000000000071",
  evidence2Id: "01940000-0000-7000-8000-000000000072",
  donation1Id: "01940000-0000-7000-8000-000000000051",
  donation2Id: "01940000-0000-7000-8000-000000000052",
  donation3Id: "01940000-0000-7000-8000-000000000053",
  bankTx1Id: "01940000-0000-7000-8000-000000000081",
  bankTx2Id: "01940000-0000-7000-8000-000000000082",
  bankTx3Id: "01940000-0000-7000-8000-000000000083",
  bankTx4PaidExpenseId: "01940000-0000-7000-8000-000000000084",
} as const;

function asPseudonymId(id: string): PseudonymId {
  const result = parsePseudonymId(`psn_${id}`);
  if (!result.ok) throw new Error(`Invalid pseudonym: psn_${id}`);
  return result.value;
}

type EventPayload<T extends Event["type"]> = (Event & { type: T })["payload"];
type DonationId = EventPayload<"donation.pledged">["donation_id"];
type ExpenseId = EventPayload<"expense.submitted">["expense_id"];
type EvidenceId = EventPayload<"expense.evidence_added">["evidence_id"];
type BankTransactionId = EventPayload<"donation.verified">["bank_transaction_id"];

const asDonationId = (id: string): DonationId => id as unknown as DonationId;
const asExpenseId = (id: string): ExpenseId => id as unknown as ExpenseId;
const asEvidenceId = (id: string): EvidenceId => id as unknown as EvidenceId;
const asBankTxId = (id: string): BankTransactionId => id as unknown as BankTransactionId;

export async function ensureDevTables(sql: Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      token_hash text NOT NULL UNIQUE,
      user_agent text NOT NULL DEFAULT '',
      device_info text NOT NULL DEFAULT '',
      ip_address text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_active_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);

    CREATE TABLE IF NOT EXISTS expense_requests (
      id uuid PRIMARY KEY,
      fund_id uuid NOT NULL REFERENCES funds(id),
      requester_id uuid NOT NULL REFERENCES users(id),
      amount_paise bigint NOT NULL CHECK (amount_paise > 0),
      description text NOT NULL,
      recipient_ref text NOT NULL,
      status text NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'expired', 'paid', 'reconciled')),
      hold_id uuid,
      approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
      evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
      bank_transaction_id uuid,
      submitted_at timestamptz,
      approved_at timestamptz,
      paid_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS expense_requests_fund_id_idx ON expense_requests(fund_id);
    CREATE INDEX IF NOT EXISTS expense_requests_requester_id_idx ON expense_requests(requester_id);

    CREATE TABLE IF NOT EXISTS donation_pledges (
      id uuid PRIMARY KEY,
      fund_id uuid NOT NULL REFERENCES funds(id),
      amount_paise bigint NOT NULL CHECK (amount_paise > 0),
      utr text NOT NULL UNIQUE CHECK (utr ~ '^[0-9]{12}$'),
      donor_display_name text,
      donor_contact text,
      status text NOT NULL DEFAULT 'pledged' CHECK (status IN ('pledged', 'verified', 'rejected')),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      verified_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS donation_pledges_fund_id_idx ON donation_pledges(fund_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS konto_accounts (
      id uuid PRIMARY KEY,
      name text NOT NULL UNIQUE,
      account_type text NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
      currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS konto_journals (
      id uuid PRIMARY KEY,
      account_id uuid NOT NULL REFERENCES konto_accounts(id),
      description text,
      metadata jsonb,
      idempotency_key text,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS konto_journals_account_id_idx ON konto_journals(account_id);

    CREATE TABLE IF NOT EXISTS konto_entries (
      id uuid PRIMARY KEY,
      entry_sequence bigint NOT NULL UNIQUE,
      journal_id uuid NOT NULL REFERENCES konto_journals(id),
      account_id uuid NOT NULL REFERENCES konto_accounts(id),
      amount bigint NOT NULL CHECK (amount != 0),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS konto_entries_journal_id_idx ON konto_entries(journal_id);
    CREATE INDEX IF NOT EXISTS konto_entries_account_id_idx ON konto_entries(account_id);
  `);
}

export async function seedDevDatabase(sql: Sql): Promise<DevSeedResult> {
  // Ensure base schema migrations have run
  await migrate(sql);

  // Ensure supplemental dev tables with indexed foreign keys exist
  await ensureDevTables(sql);

  const C = SEED_CONSTANTS;

  const usersData: DevSeedUser[] = [
    {
      id: C.treasurerUserId,
      phone: "+919876543210",
      displayName: "Aarav Sharma",
      locale: "en",
      role: "treasurer",
      pseudonymId: C.treasurerPseudonymId,
      actor: `psn_${C.treasurerPseudonymId}`,
      sessionToken: "yen_mock_session_treasurer_token",
    },
    {
      id: C.approver1UserId,
      phone: "+919876543211",
      displayName: "Priya Verma",
      locale: "en",
      role: "approver",
      pseudonymId: C.approver1PseudonymId,
      actor: `psn_${C.approver1PseudonymId}`,
      sessionToken: "yen_mock_session_approver1_token",
    },
    {
      id: C.approver2UserId,
      phone: "+919876543212",
      displayName: "Rohan Iyer",
      locale: "hi",
      role: "approver",
      pseudonymId: C.approver2PseudonymId,
      actor: `psn_${C.approver2PseudonymId}`,
      sessionToken: "yen_mock_session_approver2_token",
    },
    {
      id: C.donor1UserId,
      phone: "+919876543213",
      displayName: "Ananya Sen",
      locale: "en",
      role: "member",
      pseudonymId: C.donor1PseudonymId,
      actor: `psn_${C.donor1PseudonymId}`,
      sessionToken: "yen_mock_session_donor1_token",
    },
    {
      id: C.donor2UserId,
      phone: "+919876543214",
      displayName: "Vikram Malhotra",
      locale: "en",
      role: "member",
      pseudonymId: C.donor2PseudonymId,
      actor: `psn_${C.donor2PseudonymId}`,
      sessionToken: "yen_mock_session_donor2_token",
    },
    {
      id: C.donor3UserId,
      phone: "+919876543215",
      displayName: "Sunita Rao",
      locale: "hi",
      role: "member",
      pseudonymId: C.donor3PseudonymId,
      actor: `psn_${C.donor3PseudonymId}`,
      sessionToken: "yen_mock_session_donor3_token",
    },
  ];

  // 1. Insert Users, Pseudonyms, and Sessions
  for (const u of usersData) {
    await sql`
      INSERT INTO users (id, phone, display_name, locale)
      VALUES (${u.id}, ${u.phone}, ${u.displayName}, ${u.locale})
      ON CONFLICT (id) DO UPDATE
      SET phone = EXCLUDED.phone, display_name = EXCLUDED.display_name, locale = EXCLUDED.locale
    `;

    await sql`
      INSERT INTO pseudonyms (pseudonym_id, user_id)
      VALUES (${u.pseudonymId}, ${u.id})
      ON CONFLICT (pseudonym_id) DO NOTHING
    `;

    const tokenHash = createHash("sha256").update(u.sessionToken).digest("hex");
    await sql`
      INSERT INTO sessions (
        id, user_id, token_hash, user_agent, device_info, ip_address, expires_at
      ) VALUES (
        gen_random_uuid(), ${u.id}, ${tokenHash},
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Development Session (Mock)', '127.0.0.1',
        CURRENT_TIMESTAMP + INTERVAL '1 year'
      )
      ON CONFLICT (token_hash) DO NOTHING
    `;
  }

  // 2. Insert Demo Organization
  const orgData = {
    id: C.orgId,
    name: "IIT Delhi Robotics Club",
    legalForm: "student_society",
    ownerId: C.treasurerUserId,
  };
  await sql`
    INSERT INTO orgs (id, name, legal_form, owner_id)
    VALUES (${orgData.id}, ${orgData.name}, ${orgData.legalForm}, ${orgData.ownerId})
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name, legal_form = EXCLUDED.legal_form, owner_id = EXCLUDED.owner_id
  `;

  // 3. Insert Active Fund with Payee VPA and UPI details
  const fundPolicy = {
    visibilityTier: "public" as const,
    approvalQuorum: 2,
    spendThresholds: [{ minAmountPaise: paise(5000000), requiredQuorum: 2 }],
    objectionWindowHours: 48,
    upiVpa: "iitd.robotics@sbi",
    upiPayeeName: "IIT Delhi Robotics Club",
    payeeVpa: "iitd.robotics@sbi",
    accountNumber: "100098765432",
    ifsc: "SBIN0001077",
    bankName: "State Bank of India",
  };

  const fundData = {
    id: C.fundId,
    orgId: C.orgId,
    title: "RoboCup 2026 Asia Fund",
    targetPaise: 100000000n, // ₹10,00,000 (10 Lakhs in paise)
    visibilityTier: "public" as const,
    upiVpa: "iitd.robotics@sbi",
    upiPayeeName: "IIT Delhi Robotics Club",
    status: "active" as const,
  };

  await sql`
    INSERT INTO funds (id, org_id, title, target_paise, visibility_tier, policy_json, status)
    VALUES (
      ${fundData.id}, ${fundData.orgId}, ${fundData.title}, ${fundData.targetPaise},
      ${fundData.visibilityTier}, ${sql.json(fundPolicy)}, ${fundData.status}
    )
    ON CONFLICT (id) DO UPDATE
    SET title = EXCLUDED.title, target_paise = EXCLUDED.target_paise,
        visibility_tier = EXCLUDED.visibility_tier, policy_json = EXCLUDED.policy_json,
        status = EXCLUDED.status
  `;

  // 4. Insert Memberships
  for (const u of usersData) {
    await sql`
      INSERT INTO memberships (fund_id, user_id, role, status)
      VALUES (${fundData.id}, ${u.id}, ${u.role}, 'active')
      ON CONFLICT (fund_id, user_id, role) DO UPDATE SET status = 'active'
    `;
  }

  // 5. Insert Donation Pledges
  const donations = [
    {
      id: C.donation1Id,
      fundId: fundData.id,
      amountPaise: 20000000n, // ₹2,00,000
      utr: "123456789012",
      donorDisplayName: "Ananya Sen",
      donorContact: "+919876543213",
      status: "verified",
      verifiedAt: "2026-01-02T10:05:00.000Z",
    },
    {
      id: C.donation2Id,
      fundId: fundData.id,
      amountPaise: 20000000n, // ₹2,00,000
      utr: "123456789013",
      donorDisplayName: "Vikram Malhotra",
      donorContact: "+919876543214",
      status: "verified",
      verifiedAt: "2026-01-03T11:05:00.000Z",
    },
    {
      id: C.donation3Id,
      fundId: fundData.id,
      amountPaise: 10000000n, // ₹1,00,000
      utr: "123456789014",
      donorDisplayName: "Sunita Rao",
      donorContact: "+919876543215",
      status: "verified",
      verifiedAt: "2026-01-04T12:05:00.000Z",
    },
  ];

  for (const d of donations) {
    await sql`
      INSERT INTO donation_pledges (
        id, fund_id, amount_paise, utr, donor_display_name, donor_contact, status, verified_at
      ) VALUES (
        ${d.id}, ${d.fundId}, ${d.amountPaise}, ${d.utr}, ${d.donorDisplayName},
        ${d.donorContact}, ${d.status}, ${d.verifiedAt}::timestamptz
      )
      ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status, verified_at = EXCLUDED.verified_at
    `;
  }

  // 6. Insert 3 Expense Requests (1 approved with evidence, 1 pending approval, 1 paid)
  const exp1: DevSeedExpense = {
    id: C.expense1ApprovedId,
    fundId: fundData.id,
    requesterId: C.treasurerUserId,
    amountPaise: paise(7500000), // ₹75,000
    description: "RoboCup 2026 Asia - High-torque brushless motor set & ESCs",
    recipientRef: "Robu.in Innovation Labs (Vendor)",
    status: "approved",
    evidenceId: C.evidence1Id,
    contentSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  };

  const exp2: DevSeedExpense = {
    id: C.expense2PendingId,
    fundId: fundData.id,
    requesterId: C.treasurerUserId,
    amountPaise: paise(2500000), // ₹25,000
    description: "LiPo battery packs and safety charging station",
    recipientRef: "Tanotis Electronic Systems (Vendor)",
    status: "submitted",
  };

  const exp3: DevSeedExpense = {
    id: C.expense3PaidId,
    fundId: fundData.id,
    requesterId: C.treasurerUserId,
    amountPaise: paise(3500000), // ₹35,000
    description: "RoboCup Asia Pacific 2026 Team Registration Fee",
    recipientRef: "RoboCup Asia Pacific Federation",
    status: "paid",
    evidenceId: C.evidence2Id,
    contentSha256: "d41d8cd98f00b204e9800998ecf8427e00000000000000000000000000000000",
    bankTransactionId: C.bankTx4PaidExpenseId,
    utr: "987654321001",
  };

  const expensesData: readonly DevSeedExpense[] = [exp1, exp2, exp3];

  await sql`
    INSERT INTO expense_requests (
      id, fund_id, requester_id, amount_paise, description, recipient_ref, status,
      approvals, evidence, submitted_at, approved_at, paid_at, bank_transaction_id
    ) VALUES
    (
      ${exp1.id}, ${fundData.id}, ${exp1.requesterId},
      ${BigInt(exp1.amountPaise)}, ${exp1.description},
      ${exp1.recipientRef}, 'approved',
      ${sql.json([
        { approverId: `psn_${C.approver1PseudonymId}`, approvedAt: "2026-01-18T11:00:00.000Z" },
        { approverId: `psn_${C.approver2PseudonymId}`, approvedAt: "2026-01-18T11:30:00.000Z" },
      ])},
      ${sql.json([
        {
          evidenceId: C.evidence1Id,
          contentSha256: exp1.contentSha256,
          filename: "motors_invoice.pdf",
        },
      ])},
      '2026-01-17T09:00:00.000Z'::timestamptz,
      '2026-01-18T11:30:00.000Z'::timestamptz,
      NULL,
      NULL
    ),
    (
      ${exp2.id}, ${fundData.id}, ${exp2.requesterId},
      ${BigInt(exp2.amountPaise)}, ${exp2.description},
      ${exp2.recipientRef}, 'submitted',
      '[]'::jsonb,
      '[]'::jsonb,
      '2026-01-22T14:30:00.000Z'::timestamptz,
      NULL,
      NULL,
      NULL
    ),
    (
      ${exp3.id}, ${fundData.id}, ${exp3.requesterId},
      ${BigInt(exp3.amountPaise)}, ${exp3.description},
      ${exp3.recipientRef}, 'paid',
      ${sql.json([
        { approverId: `psn_${C.approver1PseudonymId}`, approvedAt: "2026-01-10T12:00:00.000Z" },
        { approverId: `psn_${C.approver2PseudonymId}`, approvedAt: "2026-01-10T14:00:00.000Z" },
      ])},
      ${sql.json([
        {
          evidenceId: C.evidence2Id,
          contentSha256: exp3.contentSha256,
          filename: "registration_receipt.pdf",
        },
      ])},
      '2026-01-09T10:00:00.000Z'::timestamptz,
      '2026-01-10T14:00:00.000Z'::timestamptz,
      '2026-01-11T16:00:00.000Z'::timestamptz,
      ${C.bankTx4PaidExpenseId}
    )
    ON CONFLICT (id) DO UPDATE
    SET status = EXCLUDED.status, approvals = EXCLUDED.approvals,
        evidence = EXCLUDED.evidence, paid_at = EXCLUDED.paid_at,
        bank_transaction_id = EXCLUDED.bank_transaction_id
  `;

  // 7. Konto Ledger Double-Entry Records
  const bankAccountId = "01940000-0000-7000-8000-000000000031";
  const donationsAccountId = "01940000-0000-7000-8000-000000000032";
  const expensesAccountId = "01940000-0000-7000-8000-000000000033";
  const pendingSpendAccountId = "01940000-0000-7000-8000-000000000034";

  await sql`
    INSERT INTO konto_accounts (id, name, account_type, currency)
    VALUES
      (${bankAccountId}, ${`fund:${fundData.id}:bank`}, 'ASSET', 'INR'),
      (${donationsAccountId}, ${`fund:${fundData.id}:donations`}, 'REVENUE', 'INR'),
      (${expensesAccountId}, ${`fund:${fundData.id}:expenses`}, 'EXPENSE', 'INR'),
      (${pendingSpendAccountId}, ${`fund:${fundData.id}:pending_spend`}, 'LIABILITY', 'INR')
    ON CONFLICT (id) DO NOTHING
  `;

  const journal1Id = "01940000-0000-7000-8000-000000000041";
  const journal2Id = "01940000-0000-7000-8000-000000000042";

  await sql`
    INSERT INTO konto_journals (id, account_id, description, idempotency_key)
    VALUES
      (${journal1Id}, ${bankAccountId}, 'Initial donor verified contributions', 'seed_donations_batch_1'),
      (${journal2Id}, ${expensesAccountId}, 'Disbursement for RoboCup Asia registration', 'seed_expense_paid_1')
    ON CONFLICT (id) DO NOTHING
  `;

  // Journal 1 Entries (Donations Inflow: +₹5,00,000 Asset Bank, -₹5,00,000 Revenue Donations, zero-sum)
  // Journal 2 Entries (Paid Expense: +₹35,000 Expense, -₹35,000 Asset Bank, zero-sum)
  await sql`
    INSERT INTO konto_entries (id, entry_sequence, journal_id, account_id, amount)
    VALUES
      (gen_random_uuid(), 1, ${journal1Id}, ${bankAccountId}, 50000000),
      (gen_random_uuid(), 2, ${journal1Id}, ${donationsAccountId}, -50000000),
      (gen_random_uuid(), 3, ${journal2Id}, ${expensesAccountId}, 3500000),
      (gen_random_uuid(), 4, ${journal2Id}, ${bankAccountId}, -3500000)
    ON CONFLICT (entry_sequence) DO NOTHING
  `;

  // 8. Chained Append-Only Event Log
  // Check if fund events have already been seeded to maintain append-only immutability
  const eventRows = await sql`
    SELECT count(*)::int as count FROM fund_events WHERE fund_id = ${fundData.id}
  `;
  const existingCount = Number(eventRows[0]?.count ?? 0);

  let totalEvents = existingCount;
  if (existingCount === 0) {
    const treasurerActor = asPseudonymId(C.treasurerPseudonymId);
    const approver1Actor = asPseudonymId(C.approver1PseudonymId);
    const approver2Actor = asPseudonymId(C.approver2PseudonymId);
    const donor1Actor = asPseudonymId(C.donor1PseudonymId);
    const donor2Actor = asPseudonymId(C.donor2PseudonymId);
    const donor3Actor = asPseudonymId(C.donor3PseudonymId);

    const parsedFund = parseFundId(fundData.id);
    if (!parsedFund.ok) throw new Error(parsedFund.error);
    const fundId = parsedFund.value;

    const parsedOrg = parseOrgId(fundData.orgId);
    if (!parsedOrg.ok) throw new Error(parsedOrg.error);
    const orgId = parsedOrg.value;

    const eventsToAppend: readonly AppendEventInput[] = [
      {
        fundId,
        type: "fund.created",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { org_id: orgId, visibility: "public" },
      },
      {
        fundId,
        type: "fund.policy_changed",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-01T00:01:00.000Z",
        payload: { approval_quorum: 2, objection_window_hours: 48 },
      },
      {
        fundId,
        type: "member.added",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-01T00:02:00.000Z",
        payload: { member_id: approver1Actor, role: "approver" },
      },
      {
        fundId,
        type: "member.added",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-01T00:03:00.000Z",
        payload: { member_id: approver2Actor, role: "approver" },
      },
      {
        fundId,
        type: "donation.pledged",
        version: 1,
        actor: donor1Actor,
        occurredAt: "2026-01-02T10:00:00.000Z",
        payload: { donation_id: asDonationId(C.donation1Id), amount_paise: paise(20000000) },
      },
      {
        fundId,
        type: "donation.verified",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-02T10:05:00.000Z",
        payload: {
          donation_id: asDonationId(C.donation1Id),
          bank_transaction_id: asBankTxId(C.bankTx1Id),
        },
      },
      {
        fundId,
        type: "bank.credit_seen",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-02T10:05:01.000Z",
        payload: { bank_transaction_id: asBankTxId(C.bankTx1Id), amount_paise: paise(20000000) },
      },
      {
        fundId,
        type: "donation.pledged",
        version: 1,
        actor: donor2Actor,
        occurredAt: "2026-01-03T11:00:00.000Z",
        payload: { donation_id: asDonationId(C.donation2Id), amount_paise: paise(20000000) },
      },
      {
        fundId,
        type: "donation.verified",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-03T11:05:00.000Z",
        payload: {
          donation_id: asDonationId(C.donation2Id),
          bank_transaction_id: asBankTxId(C.bankTx2Id),
        },
      },
      {
        fundId,
        type: "bank.credit_seen",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-03T11:05:01.000Z",
        payload: { bank_transaction_id: asBankTxId(C.bankTx2Id), amount_paise: paise(20000000) },
      },
      {
        fundId,
        type: "donation.pledged",
        version: 1,
        actor: donor3Actor,
        occurredAt: "2026-01-04T12:00:00.000Z",
        payload: { donation_id: asDonationId(C.donation3Id), amount_paise: paise(10000000) },
      },
      {
        fundId,
        type: "donation.verified",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-04T12:05:00.000Z",
        payload: {
          donation_id: asDonationId(C.donation3Id),
          bank_transaction_id: asBankTxId(C.bankTx3Id),
        },
      },
      {
        fundId,
        type: "bank.credit_seen",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-04T12:05:01.000Z",
        payload: { bank_transaction_id: asBankTxId(C.bankTx3Id), amount_paise: paise(10000000) },
      },
      {
        fundId,
        type: "expense.submitted",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-09T10:00:00.000Z",
        payload: { expense_id: asExpenseId(C.expense3PaidId), amount_paise: paise(3500000) },
      },
      {
        fundId,
        type: "expense.evidence_added",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-09T10:02:00.000Z",
        payload: {
          expense_id: asExpenseId(C.expense3PaidId),
          evidence_id: asEvidenceId(C.evidence2Id),
          content_sha256: "d41d8cd98f00b204e9800998ecf8427e00000000000000000000000000000000",
        },
      },
      {
        fundId,
        type: "expense.approved",
        version: 1,
        actor: approver1Actor,
        occurredAt: "2026-01-10T14:00:00.000Z",
        payload: { expense_id: asExpenseId(C.expense3PaidId) },
      },
      {
        fundId,
        type: "expense.paid",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-11T16:00:00.000Z",
        payload: {
          expense_id: asExpenseId(C.expense3PaidId),
          bank_transaction_id: asBankTxId(C.bankTx4PaidExpenseId),
        },
      },
      {
        fundId,
        type: "bank.debit_seen",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-11T16:00:01.000Z",
        payload: {
          bank_transaction_id: asBankTxId(C.bankTx4PaidExpenseId),
          amount_paise: paise(3500000),
        },
      },
      {
        fundId,
        type: "expense.submitted",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-17T09:00:00.000Z",
        payload: { expense_id: asExpenseId(C.expense1ApprovedId), amount_paise: paise(7500000) },
      },
      {
        fundId,
        type: "expense.evidence_added",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-17T09:05:00.000Z",
        payload: {
          expense_id: asExpenseId(C.expense1ApprovedId),
          evidence_id: asEvidenceId(C.evidence1Id),
          content_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      },
      {
        fundId,
        type: "expense.approved",
        version: 1,
        actor: approver1Actor,
        occurredAt: "2026-01-18T11:00:00.000Z",
        payload: { expense_id: asExpenseId(C.expense1ApprovedId) },
      },
      {
        fundId,
        type: "expense.submitted",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-22T14:30:00.000Z",
        payload: { expense_id: asExpenseId(C.expense2PendingId), amount_paise: paise(2500000) },
      },
      {
        fundId,
        type: "bank.balance_checked",
        version: 1,
        actor: treasurerActor,
        occurredAt: "2026-01-22T14:30:01.000Z",
        payload: { balance_paise: paise(46500000) },
      },
    ];

    for (const evt of eventsToAppend) {
      await appendEvent(sql, evt);
    }
    totalEvents = eventsToAppend.length;
  }

  const initialDonationsPaise = paise(50000000);
  const paidExpensesPaise = paise(3500000);
  const currentBalancePaise = paise(initialDonationsPaise - paidExpensesPaise);

  return {
    org: orgData,
    fund: fundData,
    users: usersData,
    expenses: expensesData,
    ledger: {
      initialDonationsPaise,
      paidExpensesPaise,
      currentBalancePaise,
      isZeroSum: true,
    },
    eventCount: totalEvents,
  };
}
