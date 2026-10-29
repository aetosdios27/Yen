import type { z } from "@hono/zod-openapi";
import { fundRowSchema, type Sql, uuidv7 } from "@yen/db";
import type { FundRole } from "@yen/policy";
import type { fundSchema } from "./contract.js";
import type { FundRecord } from "./policy.js";

export type FundView = z.infer<typeof fundSchema>;

const MEMBER_ROLE_ORDER = ["owner", "treasurer", "approver", "auditor", "member"] as const;

type PersistedFundSettings = {
  visibilityPreset?: "public" | "donors" | "members" | "private";
  thresholds?: Record<string, unknown>;
  payee?: { vpa: string; payeeName?: string };
  policy?: Record<string, unknown>;
};

const defaultSettings = (fund: FundView): PersistedFundSettings => ({
  visibilityPreset: fund.visibility,
  thresholds: {},
  payee: { vpa: fund.upiVpa, payeeName: fund.upiPayeeName },
  policy: {},
});

function parseSettings(value: unknown): PersistedFundSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as PersistedFundSettings;
}

function toFundRecord(row: unknown): FundRecord {
  const parsed = fundRowSchema.parse(row);
  const ownerIdRaw = (row as { owner_id?: unknown }).owner_id;
  if (typeof ownerIdRaw !== "string") {
    throw new Error("Fund row is missing owner_id");
  }

  const settings = parseSettings(parsed.fund_settings_json);
  const payeeFromSettings = settings.payee;
  const upiVpa =
    typeof parsed.upi_vpa === "string"
      ? parsed.upi_vpa
      : typeof payeeFromSettings?.vpa === "string"
        ? payeeFromSettings.vpa
        : "unknown@upi";
  const upiPayeeName =
    typeof parsed.upi_payee_name === "string"
      ? parsed.upi_payee_name
      : typeof payeeFromSettings?.payeeName === "string"
        ? payeeFromSettings.payeeName
        : "Unknown";

  return {
    owner: ownerIdRaw,
    fund: {
      id: parsed.id,
      name: parsed.title,
      ...(typeof parsed.purpose === "string" ? { purpose: parsed.purpose } : {}),
      targetPaise: parsed.target_paise === null ? "0" : parsed.target_paise.toString(10),
      visibility: parsed.visibility_tier,
      upiVpa,
      upiPayeeName,
      createdAt: parsed.created_at.toISOString(),
    },
  };
}

export interface FundStore {
  get(fundId: string): Promise<FundRecord | undefined>;
  create(fundId: string, ownerId: string, fund: FundView): Promise<void>;
  setPayee(fundId: string, vpa: string): Promise<boolean>;
  setPolicy(fundId: string, policyJson: Record<string, unknown>): Promise<boolean>;
  addMember(
    fundId: string,
    userId: string,
    role: "approver" | "treasurer" | "member",
  ): Promise<boolean>;
  removeMember(fundId: string, userId: string): Promise<boolean>;
  getMemberRole(fundId: string, userId: string): Promise<FundRole | undefined>;
}

export class MemoryFundStore implements FundStore {
  private readonly funds = new Map<string, FundRecord>();
  private readonly memberships = new Map<string, "owner" | "treasurer" | "approver" | "member">();

  async get(fundId: string) {
    return this.funds.get(fundId);
  }

  async create(fundId: string, ownerId: string, fund: FundView) {
    this.funds.set(fundId, { owner: ownerId, fund });
    this.memberships.set(`${fundId}:${ownerId}`, "owner");
  }

  async setPayee(fundId: string, vpa: string) {
    const current = this.funds.get(fundId);
    if (!current) return false;
    this.funds.set(fundId, {
      ...current,
      fund: {
        ...current.fund,
        upiVpa: vpa,
      },
    });
    return true;
  }

  async setPolicy(fundId: string, policyJson: Record<string, unknown>) {
    const current = this.funds.get(fundId);
    if (!current) return false;
    const visibility = policyJson.visibilityPreset;
    this.funds.set(fundId, {
      ...current,
      fund: {
        ...current.fund,
        visibility:
          visibility === "public" ||
          visibility === "donors" ||
          visibility === "members" ||
          visibility === "private"
            ? visibility
            : current.fund.visibility,
      },
    });
    return true;
  }

  async addMember(fundId: string, userId: string, role: "approver" | "treasurer" | "member") {
    const current = this.funds.get(fundId);
    if (!current) return false;
    this.memberships.set(`${fundId}:${userId}`, role);
    return true;
  }

  async removeMember(fundId: string, userId: string) {
    const current = this.funds.get(fundId);
    if (!current) return false;
    this.memberships.delete(`${fundId}:${userId}`);
    return true;
  }

  async getMemberRole(fundId: string, userId: string): Promise<FundRole | undefined> {
    const fund = this.funds.get(fundId);
    if (!fund) return undefined;
    if (fund.owner === userId) return "owner";
    const role = this.memberships.get(`${fundId}:${userId}`);
    return role as FundRole | undefined;
  }
}

export class PostgresFundStore implements FundStore {
  constructor(private readonly sql: Sql) {}

  async get(fundId: string): Promise<FundRecord | undefined> {
    const rows = await this.sql`
      SELECT funds.*, orgs.owner_id
      FROM funds
      JOIN orgs ON orgs.id = funds.org_id
      WHERE funds.id = ${fundId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    return toFundRecord(row);
  }

  async create(fundId: string, ownerId: string, fund: FundView): Promise<void> {
    await this.sql.begin(async (tx) => {
      const orgId = uuidv7();
      await tx`
        INSERT INTO orgs (id, name, legal_form, owner_id)
        VALUES (${orgId}, ${fund.name}, 'society', ${ownerId})
      `;
      await tx`
        INSERT INTO funds (
          id, org_id, title, purpose, target_paise, visibility_tier,
          upi_vpa, upi_payee_name, policy_json, fund_settings_json, status, created_at
        ) VALUES (
          ${fundId},
          ${orgId},
          ${fund.name},
          ${fund.purpose ?? null},
          ${BigInt(fund.targetPaise)},
          ${fund.visibility},
          ${fund.upiVpa},
          ${fund.upiPayeeName},
          '{}'::jsonb,
          ${JSON.stringify(defaultSettings(fund))}::jsonb,
          'active',
          ${new Date(fund.createdAt)}
        )
      `;
      await tx`
        INSERT INTO memberships (fund_id, user_id, role, status)
        VALUES (${fundId}, ${ownerId}, 'owner', 'active')
        ON CONFLICT (fund_id, user_id, role) DO UPDATE
        SET status = EXCLUDED.status
      `;
    });
  }

  async setPayee(fundId: string, vpa: string): Promise<boolean> {
    const result = await this.sql`
      UPDATE funds
      SET
        upi_vpa = ${vpa},
        fund_settings_json = jsonb_set(
          COALESCE(fund_settings_json, '{}'::jsonb),
          '{payee}',
          jsonb_build_object('vpa', ${vpa}, 'payeeName', upi_payee_name),
          true
        )
      WHERE id = ${fundId}
      RETURNING id
    `;
    return result.length > 0;
  }

  async setPolicy(fundId: string, policyJson: Record<string, unknown>): Promise<boolean> {
    const visibility = policyJson.visibilityPreset;
    const visibilityTier =
      visibility === "public" ||
      visibility === "donors" ||
      visibility === "members" ||
      visibility === "private"
        ? visibility
        : undefined;
    const result = await this.sql`
      UPDATE funds
      SET
        policy_json = ${JSON.stringify(policyJson)}::jsonb,
        visibility_tier = COALESCE(${visibilityTier ?? null}, visibility_tier),
        fund_settings_json = jsonb_set(
          jsonb_set(
            COALESCE(fund_settings_json, '{}'::jsonb),
            '{policy}',
            ${JSON.stringify(policyJson)}::jsonb,
            true
          ),
          '{visibilityPreset}',
          to_jsonb(COALESCE(${visibilityTier ?? null}, visibility_tier)),
          true
        )
      WHERE id = ${fundId}
      RETURNING id
    `;
    return result.length > 0;
  }

  async addMember(
    fundId: string,
    userId: string,
    role: "approver" | "treasurer" | "member",
  ): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const fundRows = await tx`SELECT id FROM funds WHERE id = ${fundId}`;
      if (fundRows.length === 0) return false;
      const userRows = await tx`SELECT id FROM users WHERE id = ${userId}`;
      if (userRows.length === 0) return false;

      await tx`
        UPDATE memberships
        SET status = 'removed'
        WHERE fund_id = ${fundId}
          AND user_id = ${userId}
          AND status = 'active'
          AND role <> ${role}
      `;
      await tx`
        INSERT INTO memberships (fund_id, user_id, role, status)
        VALUES (${fundId}, ${userId}, ${role}, 'active')
        ON CONFLICT (fund_id, user_id, role) DO UPDATE
        SET status = EXCLUDED.status
      `;
      return true;
    });
  }

  async removeMember(fundId: string, userId: string): Promise<boolean> {
    const result = await this.sql`
      UPDATE memberships
      SET status = 'removed'
      WHERE fund_id = ${fundId}
        AND user_id = ${userId}
        AND status <> 'removed'
      RETURNING fund_id
    `;
    return result.length > 0;
  }

  async getMemberRole(fundId: string, userId: string): Promise<FundRole | undefined> {
    const rows = await this.sql`
      SELECT role
      FROM memberships
      WHERE fund_id = ${fundId}
        AND user_id = ${userId}
        AND status = 'active'
    `;

    const roles = rows
      .map((row) => row.role)
      .filter((role): role is (typeof MEMBER_ROLE_ORDER)[number] =>
        MEMBER_ROLE_ORDER.includes(role as (typeof MEMBER_ROLE_ORDER)[number]),
      );

    for (const role of MEMBER_ROLE_ORDER) {
      if (roles.includes(role)) {
        return role as FundRole;
      }
    }

    return undefined;
  }
}
