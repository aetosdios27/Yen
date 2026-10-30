import { appendEvent, ensureFundPseudonym, type Sql, uuidv7 } from "@yen/db";
import type { FundPolicy } from "@yen/ledger";
import { ensureFundAccounts } from "@yen/ledger";
import { type FundId, paise, parseOrgId } from "@yen/shared";
import type { FundStore } from "./dependencies.js";
import type { FundRecord } from "./policy.js";
import { DEFAULT_OBJECTION_WINDOW_HOURS } from "./policy.js";

interface FundRow {
  id: string;
  title: string;
  target_paise: bigint | null;
  visibility_tier: FundRecord["fund"]["visibility"];
  payee_vpa: string;
  payee_name: string;
  created_at: Date | string;
  policy_json: Record<string, unknown> | string;
  owner_id: string;
  version: number;
}

function decodePolicy(value: FundRow["policy_json"]): Record<string, unknown> {
  return typeof value === "string" ? (JSON.parse(value) as Record<string, unknown>) : value;
}

export class PostgresFundStore implements FundStore {
  readonly persistent = true;
  constructor(
    private readonly sql: Sql,
    private readonly beforeVisibilityEvent: () => void | Promise<void> = () => {},
  ) {}

  async get(fundId: string): Promise<FundRecord | undefined> {
    const rows = await this.sql<FundRow[]>`
      SELECT f.id, f.title, f.target_paise, f.visibility_tier, f.payee_vpa,
        f.payee_name, f.created_at, f.policy_json, o.owner_id, f.version
      FROM funds f JOIN orgs o ON o.id = f.org_id WHERE f.id = ${fundId}
    `;
    const row = rows[0];
    if (!row) return undefined;
    const policy = decodePolicy(row.policy_json);
    return {
      owner: row.owner_id,
      fund: {
        id: row.id,
        name: row.title,
        ...(typeof policy.purpose === "string" ? { purpose: policy.purpose } : {}),
        targetPaise: row.target_paise === null ? "0" : String(row.target_paise),
        upiVpa: row.payee_vpa,
        upiPayeeName: row.payee_name,
        visibility: row.visibility_tier,
        version: row.version,
        createdAt: new Date(row.created_at).toISOString(),
      },
    };
  }

  async rolesFor(fundId: string, userId: string): Promise<string[]> {
    const rows = await this.sql<{ role: string }[]>`
      SELECT role FROM memberships WHERE fund_id = ${fundId} AND user_id = ${userId} AND status = 'active'
      ORDER BY role
    `;
    return rows.map((row) => row.role);
  }

  async getPolicy(fundId: string): Promise<FundPolicy | undefined> {
    const rows = await this.sql<{ policy_json: Record<string, unknown> | string }[]>`
      SELECT policy_json FROM funds WHERE id = ${fundId}
    `;
    const value = rows[0]?.policy_json;
    if (value === undefined) return undefined;
    const policy = decodePolicy(value);
    const approvalQuorum = policy.approvalQuorum ?? policy.approval_quorum ?? 2;
    const objectionWindowHours = policy.objectionWindowHours ?? policy.objection_window_hours ?? DEFAULT_OBJECTION_WINDOW_HOURS;
    if (
      typeof approvalQuorum !== "number" ||
      !Number.isSafeInteger(approvalQuorum) ||
      typeof objectionWindowHours !== "number" ||
      !Number.isSafeInteger(objectionWindowHours)
    ) {
      throw new TypeError("Invalid stored fund policy");
    }
    const threshold = policy.requireDeviceSignatureAbove ?? null;
    if (threshold !== null && (typeof threshold !== "number" || !Number.isSafeInteger(threshold))) {
      throw new TypeError("Invalid stored fund policy");
    }
    return {
      approvalQuorum: Number(approvalQuorum),
      objectionWindowHours: Number(objectionWindowHours),
      autoExpireHours: Number(policy.autoExpireHours ?? policy.auto_expire_hours ?? 72),
      requireDeviceSignatureAbove: threshold === null ? null : paise(threshold),
    };
  }

  async addMember(input: {
    fundId: string;
    actorUserId: string;
    userId: string;
    role: "approver" | "treasurer" | "member";
    occurredAt: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO memberships (fund_id, user_id, role, status)
        VALUES (${input.fundId}, ${input.userId}, ${input.role}, 'active')
        ON CONFLICT (fund_id, user_id, role) DO UPDATE SET status = 'active'
      `;
      await tx`UPDATE funds SET version = version + 1 WHERE id = ${input.fundId}`;
      const actor = await ensureFundPseudonym(tx, {
        userId: input.actorUserId,
        fundId: input.fundId,
      });
      const member = await ensureFundPseudonym(tx, { userId: input.userId, fundId: input.fundId });
      await appendEvent(tx, {
        fundId: input.fundId as FundId,
        type: "member.added",
        version: 1,
        actor,
        occurredAt: input.occurredAt,
        payload: { member_id: member, role: input.role },
      });
    });
  }

  async removeMember(input: {
    fundId: string;
    actorUserId: string;
    userId: string;
    occurredAt: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const removed = await tx`
        UPDATE memberships SET status = 'removed'
        WHERE fund_id = ${input.fundId} AND user_id = ${input.userId} AND role <> 'owner' AND status = 'active'
        RETURNING user_id
      `;
      if (removed.length === 0) return;
      await tx`UPDATE funds SET version = version + 1 WHERE id = ${input.fundId}`;
      const actor = await ensureFundPseudonym(tx, {
        userId: input.actorUserId,
        fundId: input.fundId,
      });
      const member = await ensureFundPseudonym(tx, { userId: input.userId, fundId: input.fundId });
      await appendEvent(tx, {
        fundId: input.fundId as FundId,
        type: "member.removed",
        version: 1,
        actor,
        occurredAt: input.occurredAt,
        payload: { member_id: member },
      });
    });
  }

  async changePayee(input: {
    fundId: string;
    actorUserId: string;
    vpa: string;
    occurredAt: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`UPDATE funds SET payee_vpa = ${input.vpa}, version = version + 1 WHERE id = ${input.fundId}`;
      const actor = await ensureFundPseudonym(tx, {
        userId: input.actorUserId,
        fundId: input.fundId,
      });
      await appendEvent(tx, {
        fundId: input.fundId as FundId,
        type: "fund.payee_changed",
        version: 1,
        actor,
        occurredAt: input.occurredAt,
        payload: {},
      });
    });
  }

  async changePolicy(input: {
    fundId: string;
    actorUserId: string;
    policy: Record<string, unknown>;
    occurredAt: string;
  }): Promise<void> {
    const quorum = input.policy.approvalQuorum ?? input.policy.approval_quorum;
    const objectionHours = input.policy.objectionWindowHours ?? input.policy.objection_window_hours;
    if (
      !Number.isSafeInteger(quorum) ||
      Number(quorum) < 1 ||
      !Number.isSafeInteger(objectionHours) ||
      Number(objectionHours) < 0
    ) {
      throw new TypeError("Invalid fund approval policy");
    }
    await this.sql.begin(async (tx) => {
      await tx`UPDATE funds SET policy_json = policy_json || ${tx.json(input.policy as Parameters<typeof tx.json>[0])}, version = version + 1 WHERE id = ${input.fundId}`;
      const actor = await ensureFundPseudonym(tx, {
        userId: input.actorUserId,
        fundId: input.fundId,
      });
      await appendEvent(tx, {
        fundId: input.fundId as FundId,
        type: "fund.policy_changed",
        version: 1,
        actor,
        occurredAt: input.occurredAt,
        payload: {
          approval_quorum: Number(quorum),
          objection_window_hours: Number(objectionHours),
        },
      });
    });
  }

  async create(fundId: string, record: FundRecord, ownerUserId: string): Promise<void> {
    const { fund } = record;
    const orgId = uuidv7();
    const parsedOrgId = parseOrgId(orgId);
    if (!parsedOrgId.ok) throw new TypeError("Generated organization ID is invalid");
    await this.sql.begin(async (tx) => {
      await tx`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, ${fund.name}, 'unregistered', ${ownerUserId})`;
      await tx`
        INSERT INTO funds (id, org_id, title, target_paise, visibility_tier, policy_json, payee_vpa, payee_name, created_at)
        VALUES (${fundId}, ${orgId}, ${fund.name}, ${BigInt(fund.targetPaise)}, ${fund.visibility},
          ${tx.json({ purpose: fund.purpose ?? null, approvalQuorum: 2, objectionWindowHours: 48, autoExpireHours: 72 })}, ${fund.upiVpa}, ${fund.upiPayeeName}, ${fund.createdAt})
      `;
      await tx`INSERT INTO memberships (fund_id, user_id, role, status) VALUES (${fundId}, ${ownerUserId}, 'owner', 'active')`;
      const actor = await ensureFundPseudonym(tx, { userId: ownerUserId, fundId });
      await ensureFundAccounts(tx, fundId);
      await appendEvent(tx, {
        fundId: fundId as FundId,
        type: "fund.created",
        version: 1,
        actor,
        occurredAt: fund.createdAt,
        payload: {
          org_id: parsedOrgId.value,
          visibility: fund.visibility === "donors" ? "private" : fund.visibility,
        },
      });
    });
  }

  async changeVisibility(input: {
    fundId: string;
    ownerUserId: string;
    visibility: FundRecord["fund"]["visibility"];
    expectedVersion: number;
    occurredAt: string;
  }): Promise<FundRecord | null> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<
        { visibility_tier: FundRecord["fund"]["visibility"]; version: number; owner_id: string }[]
      >`
        SELECT f.visibility_tier, f.version, o.owner_id
        FROM funds f JOIN orgs o ON o.id = f.org_id WHERE f.id = ${input.fundId} FOR UPDATE OF f
      `;
      const current = rows[0];
      if (
        !current ||
        current.owner_id !== input.ownerUserId ||
        current.version !== input.expectedVersion
      )
        return null;
      if (current.visibility_tier === input.visibility)
        return (await this.get(input.fundId)) ?? null;
      const changed = await tx`
        UPDATE funds SET visibility_tier = ${input.visibility}, version = version + 1
        WHERE id = ${input.fundId} AND version = ${input.expectedVersion}
        RETURNING id
      `;
      if (changed.length !== 1) return null;
      await this.beforeVisibilityEvent();
      const actor = await ensureFundPseudonym(tx, {
        userId: input.ownerUserId,
        fundId: input.fundId,
      });
      await appendEvent(tx, {
        fund_id: input.fundId as FundId,
        type: "fund.visibility_changed",
        version: 2,
        actor,
        occurred_at: input.occurredAt,
        payload: { old_visibility: current.visibility_tier, new_visibility: input.visibility },
      });
      const result = await tx<FundRow[]>`
        SELECT f.id, f.title, f.target_paise, f.visibility_tier, f.payee_vpa,
          f.payee_name, f.created_at, f.policy_json, o.owner_id, f.version
        FROM funds f JOIN orgs o ON o.id = f.org_id WHERE f.id = ${input.fundId}
      `;
      const row = result[0];
      if (!row) return null;
      const policy = decodePolicy(row.policy_json);
      return {
        owner: row.owner_id,
        fund: {
          id: row.id,
          name: row.title,
          ...(typeof policy.purpose === "string" ? { purpose: policy.purpose } : {}),
          targetPaise: row.target_paise === null ? "0" : String(row.target_paise),
          upiVpa: row.payee_vpa,
          upiPayeeName: row.payee_name,
          visibility: row.visibility_tier,
          version: row.version,
          createdAt: new Date(row.created_at).toISOString(),
        },
      };
    });
  }

  set(_fundId: string, _record: FundRecord): never {
    throw new Error("PostgresFundStore requires create() for persisted fund creation");
  }
}
