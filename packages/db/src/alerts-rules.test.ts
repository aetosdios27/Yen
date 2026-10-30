import { randomInt } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  REPEATED_REJECTION_THRESHOLD,
  REPEATED_REJECTION_WINDOW_DAYS,
  raiseRepeatedRejectionsIfThreshold,
  raiseSpendRateSpikeIfSpiking,
  SPEND_SPIKE_BASELINE_DAYS,
  SPEND_SPIKE_FACTOR,
  SPEND_SPIKE_MIN_ABS_PAISE,
  SPEND_SPIKE_WINDOW_HOURS,
} from "./alerts.js";
import type { Sql } from "./client.js";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function isoAgo(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

databaseSuite("alert detection rules", (sql) => {
  beforeAll(async () => migrate(sql));

  async function createFund(client: Sql): Promise<string> {
    const userId = uuidv7();
    const orgId = uuidv7();
    const fundId = uuidv7();
    const phone = `+91${randomInt(1_000_000_000, 10_000_000_000)}`;
    await client`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Owner')`;
    await client`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Org', 'society', ${userId})`;
    await client`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Fund', '{}')`;
    return fundId;
  }

  async function insertExpense(
    client: Sql,
    fundId: string,
    status: "rejected" | "paid",
    data: Record<string, unknown>,
  ): Promise<void> {
    const stamp = NOW.toISOString();
    await client`
      INSERT INTO expenses (id, fund_id, status, hold_id, expense_data, created_at, updated_at)
      VALUES (${uuidv7()}, ${fundId}, ${status}, NULL, ${client.json({ status, ...data })}, ${stamp}, ${stamp})
    `;
  }

  async function rejectionAlerts(client: Sql, fundId: string) {
    return client<{ fund_id: string; severity: string; alert_type: string }[]>`
      SELECT fund_id, severity, alert_type FROM alerts
      WHERE fund_id = ${fundId} AND alert_type = 'repeated_rejected_requests'
    `;
  }

  async function spikeAlerts(client: Sql, fundId: string) {
    return client<{ fund_id: string; severity: string; alert_type: string }[]>`
      SELECT fund_id, severity, alert_type FROM alerts
      WHERE fund_id = ${fundId} AND alert_type = 'spend_rate_spike'
    `;
  }

  describe("repeated rejections", () => {
    it("does not alert below the threshold and alerts exactly once at the threshold", async () => {
      expect(REPEATED_REJECTION_THRESHOLD).toBe(3);
      const fundId = await createFund(sql);
      const rejectedAt = (ms: number) => ({ rejectedAt: isoAgo(ms) });

      for (let i = 0; i < REPEATED_REJECTION_THRESHOLD - 1; i++) {
        await insertExpense(sql, fundId, "rejected", rejectedAt(HOUR_MS * (i + 1)));
      }
      expect(await raiseRepeatedRejectionsIfThreshold(sql, fundId, NOW)).toBeNull();
      expect(await rejectionAlerts(sql, fundId)).toHaveLength(0);

      await insertExpense(sql, fundId, "rejected", rejectedAt(HOUR_MS * 10));
      const raised = await raiseRepeatedRejectionsIfThreshold(sql, fundId, NOW);
      expect(raised).toMatchObject({
        fund_id: fundId,
        alert_type: "repeated_rejected_requests",
        severity: "warning",
      });
      expect(await rejectionAlerts(sql, fundId)).toHaveLength(1);

      // A further rejection while the alert is open is deduplicated.
      await insertExpense(sql, fundId, "rejected", rejectedAt(HOUR_MS * 11));
      expect(await raiseRepeatedRejectionsIfThreshold(sql, fundId, NOW)).toBeNull();
      expect(await rejectionAlerts(sql, fundId)).toHaveLength(1);
    });

    it("counts a rejection exactly at the window start and ignores one a millisecond older", async () => {
      const windowMs = REPEATED_REJECTION_WINDOW_DAYS * DAY_MS;
      const inside = await createFund(sql);
      await insertExpense(sql, inside, "rejected", { rejectedAt: isoAgo(HOUR_MS) });
      await insertExpense(sql, inside, "rejected", { rejectedAt: isoAgo(HOUR_MS * 2) });
      await insertExpense(sql, inside, "rejected", { rejectedAt: isoAgo(windowMs) });
      expect(await raiseRepeatedRejectionsIfThreshold(sql, inside, NOW)).toMatchObject({
        alert_type: "repeated_rejected_requests",
      });

      const outside = await createFund(sql);
      await insertExpense(sql, outside, "rejected", { rejectedAt: isoAgo(HOUR_MS) });
      await insertExpense(sql, outside, "rejected", { rejectedAt: isoAgo(HOUR_MS * 2) });
      await insertExpense(sql, outside, "rejected", { rejectedAt: isoAgo(windowMs + 1) });
      expect(await raiseRepeatedRejectionsIfThreshold(sql, outside, NOW)).toBeNull();
      expect(await rejectionAlerts(sql, outside)).toHaveLength(0);
    });
  });

  describe("spend rate spike", () => {
    const BASELINE_DAILY_PAISE = 200_000n;
    // Prior 30 days hold a total of BASELINE_DAILY * BASELINE_DAYS paid; the window starts 24h ago.
    async function seedBaseline(client: Sql, fundId: string): Promise<void> {
      const total = BASELINE_DAILY_PAISE * BigInt(SPEND_SPIKE_BASELINE_DAYS);
      await insertExpense(client, fundId, "paid", {
        amountPaise: Number(total),
        paidAt: isoAgo(SPEND_SPIKE_WINDOW_HOURS * HOUR_MS + DAY_MS),
      });
    }
    async function seedRecent(client: Sql, fundId: string, paise: bigint): Promise<void> {
      await insertExpense(client, fundId, "paid", {
        amountPaise: Number(paise),
        paidAt: isoAgo(HOUR_MS),
      });
    }

    it("does not alert when recent spend is at or below the factor times the daily baseline", async () => {
      const fundId = await createFund(sql);
      await seedBaseline(sql, fundId);
      const atFactor = BigInt(SPEND_SPIKE_FACTOR) * BASELINE_DAILY_PAISE;
      await seedRecent(sql, fundId, atFactor);
      expect(await raiseSpendRateSpikeIfSpiking(sql, fundId, NOW)).toBeNull();
      expect(await spikeAlerts(sql, fundId)).toHaveLength(0);
    });

    it("does not alert below the absolute floor even when the relative ratio is exceeded", async () => {
      const fundId = await createFund(sql);
      // No baseline, so any spend trips the ratio; the floor alone must hold it back.
      await seedRecent(sql, fundId, SPEND_SPIKE_MIN_ABS_PAISE - 1n);
      expect(await raiseSpendRateSpikeIfSpiking(sql, fundId, NOW)).toBeNull();
      expect(await spikeAlerts(sql, fundId)).toHaveLength(0);
    });

    it("alerts exactly once when recent spend exceeds the factor and the floor", async () => {
      const fundId = await createFund(sql);
      await seedBaseline(sql, fundId);
      const aboveFactor = BigInt(SPEND_SPIKE_FACTOR) * BASELINE_DAILY_PAISE + 1n;
      expect(aboveFactor).toBeGreaterThanOrEqual(SPEND_SPIKE_MIN_ABS_PAISE);
      await seedRecent(sql, fundId, aboveFactor);
      expect(await raiseSpendRateSpikeIfSpiking(sql, fundId, NOW)).toMatchObject({
        alert_type: "spend_rate_spike",
        severity: "warning",
        fund_id: fundId,
      });
      expect(await raiseSpendRateSpikeIfSpiking(sql, fundId, NOW)).toBeNull();
      expect(await spikeAlerts(sql, fundId)).toHaveLength(1);
    });
  });
});
