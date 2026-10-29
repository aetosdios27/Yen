import { beforeAll, expect, it } from "vitest";
import {
  createApprovalPin,
  getApprovalPin,
  updateApprovalPin,
  withLockedApprovalPin,
} from "./approval-pin.js";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";

databaseSuite("approval PIN row access", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  async function pinFor(failedAttempts = 0): Promise<string> {
    const userId = uuidv7();
    const phone = `+91${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'PIN User')`;
    await createApprovalPin(sql, {
      userId,
      salt: "s".repeat(16),
      pinHash: "h".repeat(30),
      failedAttempts,
    });
    return userId;
  }

  it("leaves unspecified columns untouched and clears nullable ones only when asked", async () => {
    const userId = await pinFor(3);
    const lockedUntil = new Date("2030-01-01T00:00:00.000Z");
    await updateApprovalPin(sql, userId, { lockedUntil, totalFailed24h: 3 });

    const updated = await updateApprovalPin(sql, userId, { failedAttempts: 4 });
    expect(updated).toMatchObject({
      salt: "s".repeat(16),
      pin_hash: "h".repeat(30),
      failed_attempts: 4,
      total_failed_24h: 3,
      locked_until: lockedUntil,
      status: "active",
    });

    const cleared = await updateApprovalPin(sql, userId, { lockedUntil: null });
    expect(cleared?.locked_until).toBeNull();
    expect(cleared?.failed_attempts).toBe(4);
    expect(await updateApprovalPin(sql, uuidv7(), { failedAttempts: 1 })).toBeNull();
  });

  it("holds the row lock until the transaction commits", async () => {
    const userId = await pinFor();
    const events: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const holding = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const first = withLockedApprovalPin(sql, userId, async (tx, row) => {
      expect(row?.failed_attempts).toBe(0);
      entered();
      await gate;
      await updateApprovalPin(tx, userId, { failedAttempts: 1 });
      events.push("first committed");
    });
    await holding;
    const second = withLockedApprovalPin(sql, userId, async (_tx, row) => {
      events.push(`second saw ${row?.failed_attempts}`);
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(events).toEqual([]);
    release();
    await Promise.all([first, second]);

    expect(events).toEqual(["first committed", "second saw 1"]);
    expect((await getApprovalPin(sql, userId))?.failed_attempts).toBe(1);
  });

  it("rolls back writes when the critical section throws and reports a missing row", async () => {
    const userId = await pinFor();
    await expect(
      withLockedApprovalPin(sql, userId, async (tx) => {
        await updateApprovalPin(tx, userId, { failedAttempts: 2 });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect((await getApprovalPin(sql, userId))?.failed_attempts).toBe(0);

    expect(await withLockedApprovalPin(sql, uuidv7(), async (_tx, row) => row)).toBeNull();
  });
});
