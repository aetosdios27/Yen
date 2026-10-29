import type { Sql } from "@yen/db";
import type { PseudonymId } from "@yen/eventlog";
import { DEFAULT_FRAUD_POLICY, type FraudPolicy } from "@yen/policy";
import { paise } from "@yen/shared";

export interface PayeeProfileStore {
  set(input: {
    readonly fundId: string;
    readonly memberPseudonym: PseudonymId;
    readonly fingerprint: string;
    readonly updatedAt: string;
  }): Promise<void>;
  clear(fundId: string, memberPseudonym: PseudonymId): Promise<void>;
  getFingerprint(fundId: string, memberPseudonym: PseudonymId): Promise<string | null>;
  getMemberDisplayName(fundId: string, memberPseudonym: PseudonymId): Promise<string | null>;
  listActiveFingerprints(fundId: string): Promise<readonly string[]>;
  isActiveMember(fundId: string, memberPseudonym: PseudonymId): Promise<boolean>;
  isActiveOfficeholder(fundId: string, memberPseudonym: PseudonymId): Promise<boolean>;
  getPolicy(fundId: string): Promise<FraudPolicy>;
  setPolicy(fundId: string, policy: FraudPolicy, updatedAt: string): Promise<void>;
}

function pseudonymUuid(pseudonym: PseudonymId): string {
  return pseudonym.slice("psn_".length);
}

export class MemoryPayeeProfileStore implements PayeeProfileStore {
  private readonly fingerprints = new Map<string, string>();
  private readonly activeMembers = new Set<string>();
  private readonly officeholders = new Set<string>();
  private readonly displayNames = new Map<string, string>();
  private readonly policies = new Map<string, FraudPolicy>();

  async set(input: {
    fundId: string;
    memberPseudonym: PseudonymId;
    fingerprint: string;
    updatedAt: string;
  }) {
    const key = `${input.fundId}:${input.memberPseudonym}`;
    this.activeMembers.add(key);
    this.fingerprints.set(key, input.fingerprint);
  }

  async clear(fundId: string, memberPseudonym: PseudonymId) {
    this.fingerprints.delete(`${fundId}:${memberPseudonym}`);
  }

  async getFingerprint(fundId: string, memberPseudonym: PseudonymId) {
    return this.fingerprints.get(`${fundId}:${memberPseudonym}`) ?? null;
  }

  async getMemberDisplayName(fundId: string, memberPseudonym: PseudonymId) {
    const key = `${fundId}:${memberPseudonym}`;
    return this.activeMembers.has(key) ? (this.displayNames.get(key) ?? null) : null;
  }

  async listActiveFingerprints(fundId: string) {
    return [...this.fingerprints.entries()]
      .filter(([key]) => key.startsWith(`${fundId}:`))
      .map(([, fingerprint]) => fingerprint);
  }

  async isActiveMember(fundId: string, memberPseudonym: PseudonymId) {
    return this.activeMembers.has(`${fundId}:${memberPseudonym}`);
  }

  async isActiveOfficeholder(fundId: string, memberPseudonym: PseudonymId) {
    return this.officeholders.has(`${fundId}:${memberPseudonym}`);
  }

  async getPolicy(fundId: string) {
    return this.policies.get(fundId) ?? DEFAULT_FRAUD_POLICY;
  }

  async setPolicy(fundId: string, policy: FraudPolicy) {
    this.policies.set(fundId, policy);
  }

  setOfficeholder(fundId: string, memberPseudonym: PseudonymId, active: boolean): void {
    const key = `${fundId}:${memberPseudonym}`;
    if (active) {
      this.officeholders.add(key);
      this.activeMembers.add(key);
    } else {
      this.officeholders.delete(key);
    }
  }

  setActiveMember(fundId: string, memberPseudonym: PseudonymId, active: boolean): void {
    const key = `${fundId}:${memberPseudonym}`;
    if (active) this.activeMembers.add(key);
    else {
      this.activeMembers.delete(key);
      this.officeholders.delete(key);
      this.fingerprints.delete(key);
    }
  }

  setMemberDisplayName(fundId: string, memberPseudonym: PseudonymId, name: string): void {
    this.displayNames.set(`${fundId}:${memberPseudonym}`, name);
    this.activeMembers.add(`${fundId}:${memberPseudonym}`);
  }
}

interface FingerprintRow {
  readonly fingerprint: string;
}

interface PolicyRow {
  readonly new_payee_first_payment_paise: number | bigint;
  readonly large_expense_paise: number | bigint;
  readonly cooling_off_hours: number;
  readonly split_window_hours: number;
  readonly approval_threshold_paise: number | bigint;
  readonly velocity_window_hours: number;
  readonly velocity_max_paise: number | bigint;
  readonly blocked_flag_codes: readonly string[];
}

const FRAUD_FLAG_CODES = [
  "new_payee_large_first_payment",
  "payee_changed_cooling_off",
  "self_payment",
  "split_requests",
  "duplicate_invoice",
  "duplicate_evidence",
  "gstin_name_mismatch",
  "payee_velocity",
] as const;

export class PostgresPayeeProfileStore implements PayeeProfileStore {
  constructor(private readonly sql: Sql) {}

  async set(input: {
    fundId: string;
    memberPseudonym: PseudonymId;
    fingerprint: string;
    updatedAt: string;
  }): Promise<void> {
    const rows = await this.sql<FingerprintRow[]>`
      INSERT INTO member_payee_profiles (fund_id, pseudonym_id, fingerprint, updated_at)
      SELECT ${input.fundId}, fp.pseudonym_id, ${input.fingerprint}, ${input.updatedAt}
      FROM fund_pseudonyms fp
      WHERE fp.fund_id = ${input.fundId}
        AND fp.pseudonym_id = ${pseudonymUuid(input.memberPseudonym)}
        AND EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.fund_id = fp.fund_id AND m.user_id = fp.user_id AND m.status = 'active'
        )
      ON CONFLICT (fund_id, pseudonym_id) DO UPDATE
      SET fingerprint = EXCLUDED.fingerprint, updated_at = EXCLUDED.updated_at
      RETURNING fingerprint
    `;
    if (!rows[0]) throw new Error("Payee profile target is not an active fund member");
  }

  async clear(fundId: string, memberPseudonym: PseudonymId): Promise<void> {
    await this.sql`
      DELETE FROM member_payee_profiles
      WHERE fund_id = ${fundId} AND pseudonym_id = ${pseudonymUuid(memberPseudonym)}
    `;
  }

  async getFingerprint(fundId: string, memberPseudonym: PseudonymId): Promise<string | null> {
    const rows = await this.sql<FingerprintRow[]>`
      SELECT fingerprint FROM member_payee_profiles
      WHERE fund_id = ${fundId} AND pseudonym_id = ${pseudonymUuid(memberPseudonym)}
    `;
    return rows[0]?.fingerprint ?? null;
  }

  async getMemberDisplayName(fundId: string, memberPseudonym: PseudonymId): Promise<string | null> {
    const rows = await this.sql<{ display_name: string }[]>`
      SELECT u.display_name
      FROM fund_pseudonyms fp
      JOIN users u ON u.id = fp.user_id
      JOIN memberships m ON m.fund_id = fp.fund_id AND m.user_id = fp.user_id
      WHERE fp.fund_id = ${fundId}
        AND fp.pseudonym_id = ${pseudonymUuid(memberPseudonym)}
        AND m.status = 'active'
      LIMIT 1
    `;
    return rows[0]?.display_name ?? null;
  }

  async listActiveFingerprints(fundId: string): Promise<readonly string[]> {
    const rows = await this.sql<FingerprintRow[]>`
      SELECT DISTINCT p.fingerprint
      FROM member_payee_profiles p
      JOIN fund_pseudonyms fp ON fp.fund_id = p.fund_id AND fp.pseudonym_id = p.pseudonym_id
      JOIN memberships m ON m.fund_id = fp.fund_id AND m.user_id = fp.user_id
      WHERE p.fund_id = ${fundId} AND m.status = 'active'
    `;
    return rows.map((row) => row.fingerprint);
  }

  async isActiveMember(fundId: string, memberPseudonym: PseudonymId): Promise<boolean> {
    const rows = await this.sql<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM fund_pseudonyms fp
        JOIN memberships m ON m.fund_id = fp.fund_id AND m.user_id = fp.user_id
        WHERE fp.fund_id = ${fundId} AND fp.pseudonym_id = ${pseudonymUuid(memberPseudonym)}
          AND m.status = 'active'
      ) AS present
    `;
    return rows[0]?.present === true;
  }

  async isActiveOfficeholder(fundId: string, memberPseudonym: PseudonymId): Promise<boolean> {
    const rows = await this.sql<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM fund_pseudonyms fp
        JOIN memberships m ON m.fund_id = fp.fund_id AND m.user_id = fp.user_id
        WHERE fp.fund_id = ${fundId} AND fp.pseudonym_id = ${pseudonymUuid(memberPseudonym)}
          AND m.status = 'active' AND m.role IN ('owner', 'treasurer', 'approver')
      ) AS present
    `;
    return rows[0]?.present === true;
  }

  async getPolicy(fundId: string): Promise<FraudPolicy> {
    const rows = await this.sql<PolicyRow[]>`
      SELECT new_payee_first_payment_paise, large_expense_paise, cooling_off_hours,
        split_window_hours, approval_threshold_paise, velocity_window_hours,
        velocity_max_paise, blocked_flag_codes
      FROM fund_payee_rule_policies WHERE fund_id = ${fundId}
    `;
    const row = rows[0];
    if (!row) return DEFAULT_FRAUD_POLICY;
    const blockedFlagCodes = FRAUD_FLAG_CODES.filter((code) =>
      row.blocked_flag_codes.includes(code),
    );
    return {
      newPayeeFirstPaymentPaise: paise(Number(row.new_payee_first_payment_paise)),
      largeExpensePaise: paise(Number(row.large_expense_paise)),
      coolingOffHours: row.cooling_off_hours,
      splitWindowHours: row.split_window_hours,
      approvalThresholdPaise: paise(Number(row.approval_threshold_paise)),
      velocityWindowHours: row.velocity_window_hours,
      velocityMaxPaise: paise(Number(row.velocity_max_paise)),
      blockedFlagCodes,
    };
  }

  async setPolicy(fundId: string, policy: FraudPolicy, updatedAt: string): Promise<void> {
    await this.sql`
      INSERT INTO fund_payee_rule_policies (
        fund_id, new_payee_first_payment_paise, large_expense_paise, cooling_off_hours,
        split_window_hours, approval_threshold_paise, velocity_window_hours,
        velocity_max_paise, blocked_flag_codes, updated_at
      ) VALUES (
        ${fundId}, ${policy.newPayeeFirstPaymentPaise}, ${policy.largeExpensePaise},
        ${policy.coolingOffHours}, ${policy.splitWindowHours}, ${policy.approvalThresholdPaise},
        ${policy.velocityWindowHours}, ${policy.velocityMaxPaise},
        ${this.sql.array([...policy.blockedFlagCodes])}, ${updatedAt}
      )
      ON CONFLICT (fund_id) DO UPDATE SET
        new_payee_first_payment_paise = EXCLUDED.new_payee_first_payment_paise,
        large_expense_paise = EXCLUDED.large_expense_paise,
        cooling_off_hours = EXCLUDED.cooling_off_hours,
        split_window_hours = EXCLUDED.split_window_hours,
        approval_threshold_paise = EXCLUDED.approval_threshold_paise,
        velocity_window_hours = EXCLUDED.velocity_window_hours,
        velocity_max_paise = EXCLUDED.velocity_max_paise,
        blocked_flag_codes = EXCLUDED.blocked_flag_codes,
        updated_at = EXCLUDED.updated_at
    `;
  }
}
