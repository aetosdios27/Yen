import { createSql, migrate, uuidv7 } from "@yen/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { createApp, devPolicy } from "./app.js";
import { PostgresFundStore } from "./fund-store.js";

function createPayload(name = "Fund") {
  return {
    name,
    purpose: "Community fund",
    targetPaise: "250000",
    upiVpa: "club@upi",
    upiPayeeName: "Club Treasurer",
    visibility: "private" as const,
  };
}

databaseSuite("Postgres fund store", (sql, url) => {
  let secondSql: ReturnType<typeof createSql>;

  beforeAll(async () => {
    await migrate(sql);
    secondSql = createSql(url);
  });

  afterAll(async () => {
    await secondSql?.end({ timeout: 5 });
  });

  const insertUser = async (id: string, phone: string, displayName: string) => {
    await sql`
      INSERT INTO users (id, phone, display_name, assurance)
      VALUES (${id}, ${phone}, ${displayName}, 'otp_verified')
    `;
  };

  describe("persistence and permissions across reinstantiation", () => {
    it("persists fund + settings and reads role from memberships across app instances", async () => {
      const ownerId = uuidv7();
      const approverId = uuidv7();
      const outsiderId = uuidv7();
      const fundId = uuidv7();
      await insertUser(ownerId, "+919111111111", "Owner");
      await insertUser(approverId, "+919111111112", "Approver");
      await insertUser(outsiderId, "+919111111113", "Outsider");

      const ownerApp = createApp({
        policy: devPolicy,
        principal: { id: ownerId },
        fundStore: new PostgresFundStore(sql),
        idGenerator: () => fundId,
      });

      const created = await ownerApp.request("/v1/funds", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `fund-create-${fundId}`,
        },
        body: JSON.stringify(createPayload("Robotics Fund")),
      });
      expect(created.status).toBe(201);

      const outsiderApp = createApp({
        policy: devPolicy,
        principal: { id: outsiderId },
        fundStore: new PostgresFundStore(secondSql),
      });
      expect((await outsiderApp.request(`/v1/funds/${fundId}`)).status).toBe(404);

      const firstStore = new PostgresFundStore(sql);
      expect(await firstStore.addMember(fundId, approverId, "approver")).toBe(true);
      expect(await firstStore.setPayee(fundId, "newpayee@upi")).toBe(true);
      expect(
        await firstStore.setPolicy(fundId, {
          approvalQuorum: 3,
          thresholds: { large: "500000" },
          visibilityPreset: "members",
        }),
      ).toBe(true);

      const approverApp = createApp({
        policy: devPolicy,
        principal: { id: approverId },
        fundStore: new PostgresFundStore(secondSql),
      });
      const approverRead = await approverApp.request(`/v1/funds/${fundId}`);
      expect(approverRead.status).toBe(200);
      expect(await approverRead.json()).toMatchObject({
        id: fundId,
        upiVpa: "newpayee@upi",
        targetPaise: "250000",
        visibility: "members",
      });

      const thirdStore = new PostgresFundStore(secondSql);
      const role = await thirdStore.getMemberRole(fundId, approverId);
      expect(role).toBe("approver");
      expect(await thirdStore.removeMember(fundId, approverId)).toBe(true);

      const removedRead = await approverApp.request(`/v1/funds/${fundId}`);
      expect(removedRead.status).toBe(404);

      const row = await sql`
        SELECT policy_json, fund_settings_json, visibility_tier FROM funds WHERE id = ${fundId}
      `;
      expect(row).toHaveLength(1);
      const policyJson =
        typeof row[0]?.policy_json === "string"
          ? JSON.parse(row[0].policy_json)
          : row[0]?.policy_json;
      expect(policyJson).toMatchObject({ approvalQuorum: 3 });
      expect(row[0]?.visibility_tier).toBe("members");
      expect(row[0]?.fund_settings_json).toMatchObject({
        visibilityPreset: "members",
        policy: { approvalQuorum: 3 },
      });
    });

    it("returns missing/unauthorized responses correctly", async () => {
      const ownerId = uuidv7();
      const fundId = uuidv7();
      await insertUser(ownerId, "+919111111121", "Owner Two");

      const ownerApp = createApp({
        policy: devPolicy,
        principal: { id: ownerId },
        fundStore: new PostgresFundStore(sql),
        idGenerator: () => fundId,
      });
      await ownerApp.request("/v1/funds", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `fund-create-${fundId}`,
        },
        body: JSON.stringify(createPayload("Missing Checks")),
      });

      const noAuthApp = createApp({
        policy: devPolicy,
        principal: null,
        fundStore: new PostgresFundStore(secondSql),
      });
      expect((await noAuthApp.request(`/v1/funds/${fundId}`)).status).toBe(401);
      expect((await noAuthApp.request(`/v1/funds/${uuidv7()}`)).status).toBe(401);

      const authedApp = createApp({
        policy: devPolicy,
        principal: { id: ownerId },
        fundStore: new PostgresFundStore(secondSql),
      });
      expect((await authedApp.request(`/v1/funds/${uuidv7()}`)).status).toBe(404);
    });
  });

  describe("transaction rollback", () => {
    it("rolls back create when owner does not exist", async () => {
      const store = new PostgresFundStore(sql);
      const fundId = uuidv7();
      const missingOwner = uuidv7();
      await expect(
        store.create(fundId, missingOwner, {
          ...createPayload("Rollback"),
          id: fundId,
          createdAt: new Date().toISOString(),
        }),
      ).rejects.toThrow();

      const funds = await sql`SELECT id FROM funds WHERE id = ${fundId}`;
      const memberships = await sql`SELECT fund_id FROM memberships WHERE fund_id = ${fundId}`;
      expect(funds).toHaveLength(0);
      expect(memberships).toHaveLength(0);
    });
  });
});
