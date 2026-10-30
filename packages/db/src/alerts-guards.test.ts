import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { acknowledgeAlert, raiseAlert, resolveAlert } from "./alerts.js";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";

const ACTOR = "psn_aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";

databaseSuite("alert guards (append-only store and state machine)", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });

  async function openAlert(): Promise<string> {
    const alert = await raiseAlert(sql, {
      fundId: null,
      alertType: "integrity_check_failure",
      severity: "warning",
      title: "Integrity check failed",
      details: "Stored checksum mismatch",
      entityType: "fund",
      entityId: randomUUID(),
    });
    if (!alert) throw new Error("alert was not created");
    return alert.id;
  }

  async function acknowledgedAlert(): Promise<string> {
    const id = await openAlert();
    await acknowledgeAlert(sql, { alertId: id, actorPseudonym: ACTOR, note: "Seen" });
    return id;
  }

  async function resolvedAlert(): Promise<string> {
    const id = await openAlert();
    await resolveAlert(sql, { alertId: id, actorPseudonym: ACTOR, note: "Fixed" });
    return id;
  }

  describe("deletion and truncation", () => {
    it("rejects DELETE on alerts", async () => {
      const id = await openAlert();
      await expect(sql`DELETE FROM alerts WHERE id = ${id}`).rejects.toThrow(
        "alerts cannot be deleted, only resolved",
      );
    });

    it("rejects TRUNCATE on alerts", async () => {
      // alert_events references alerts, so Postgres refuses the TRUNCATE before the trigger runs.
      await expect(sql`TRUNCATE alerts`).rejects.toThrow(
        /cannot be truncated|cannot truncate a table referenced/,
      );
    });

    it("rejects DELETE on alert_events", async () => {
      const id = await acknowledgedAlert();
      await expect(sql`DELETE FROM alert_events WHERE alert_id = ${id}`).rejects.toThrow(
        "alert_events are append-only",
      );
    });

    it("rejects TRUNCATE on alert_events", async () => {
      await expect(sql`TRUNCATE alert_events`).rejects.toThrow("alert_events cannot be truncated");
    });

    it("rejects UPDATE on alert_events", async () => {
      const id = await acknowledgedAlert();
      await expect(
        sql`UPDATE alert_events SET note = 'rewritten' WHERE alert_id = ${id}`,
      ).rejects.toThrow("alert_events are append-only");
    });
  });

  describe("state machine", () => {
    it("blocks resolved -> open", async () => {
      const id = await resolvedAlert();
      await expect(sql`UPDATE alerts SET status = 'open' WHERE id = ${id}`).rejects.toThrow(
        "resolved alert cannot be reopened",
      );
    });

    it("blocks resolved -> acknowledged", async () => {
      const id = await resolvedAlert();
      await expect(
        sql`UPDATE alerts SET status = 'acknowledged', acknowledged_by = ${ACTOR},
              acknowledged_at = now(), acknowledgement_note = 'Reopen' WHERE id = ${id}`,
      ).rejects.toThrow("resolved alert cannot be reopened");
    });

    it("keeps an alert resolved after a rejected reopen attempt", async () => {
      const id = await resolvedAlert();
      await sql`UPDATE alerts SET status = 'open' WHERE id = ${id}`.catch(() => undefined);
      const [row] = await sql<{ status: string }[]>`SELECT status FROM alerts WHERE id = ${id}`;
      expect(row?.status).toBe("resolved");
    });
  });

  describe("notes are required", () => {
    it.each([
      ["null", null],
      ["blank", "   "],
      ["empty", ""],
    ])("rejects acknowledging with a %s note", async (_label, note) => {
      const id = await openAlert();
      await expect(
        sql`UPDATE alerts SET status = 'acknowledged', acknowledged_by = ${ACTOR},
              acknowledged_at = now(), acknowledgement_note = ${note} WHERE id = ${id}`,
      ).rejects.toThrow(/acknowledgement requires a note|acknowledgement_note|check constraint/);
    });

    it.each([
      ["null", null],
      ["blank", "   "],
    ])("rejects resolving with a %s note", async (_label, note) => {
      const id = await openAlert();
      await expect(
        sql`UPDATE alerts SET status = 'resolved', resolved_by = ${ACTOR},
              resolved_at = now(), resolution_note = ${note} WHERE id = ${id}`,
      ).rejects.toThrow(/resolution requires a note|resolution_note|check constraint/);
    });

    it("the acknowledge helper rejects a blank note and leaves the alert open", async () => {
      const id = await openAlert();
      await expect(
        acknowledgeAlert(sql, { alertId: id, actorPseudonym: ACTOR, note: "   " }),
      ).rejects.toThrow(/requires a note|check constraint/);
      const [row] = await sql<{ status: string }[]>`SELECT status FROM alerts WHERE id = ${id}`;
      expect(row?.status).toBe("open");
    });

    it("the resolve helper rejects a blank note and leaves the alert open", async () => {
      const id = await openAlert();
      await expect(
        resolveAlert(sql, { alertId: id, actorPseudonym: ACTOR, note: "" }),
      ).rejects.toThrow(/requires a note|check constraint/);
      const [row] = await sql<{ status: string }[]>`SELECT status FROM alerts WHERE id = ${id}`;
      expect(row?.status).toBe("open");
    });
  });

  describe("immutable columns", () => {
    const immutableUpdates: Array<[string, (id: string) => Promise<unknown>]> = [
      ["title", (id) => sql`UPDATE alerts SET title = 'Changed' WHERE id = ${id}`],
      ["details", (id) => sql`UPDATE alerts SET details = 'Changed' WHERE id = ${id}`],
      ["alert_type", (id) => sql`UPDATE alerts SET alert_type = 'balance_drift' WHERE id = ${id}`],
      ["severity", (id) => sql`UPDATE alerts SET severity = 'critical' WHERE id = ${id}`],
      ["dedup_key", (id) => sql`UPDATE alerts SET dedup_key = 'other' WHERE id = ${id}`],
      ["entity_id", (id) => sql`UPDATE alerts SET entity_id = 'other' WHERE id = ${id}`],
      [
        "created_at",
        (id) => sql`UPDATE alerts SET created_at = now() - interval '1 day' WHERE id = ${id}`,
      ],
    ];

    it.each(immutableUpdates)("rejects changing %s", async (_column, update) => {
      const id = await openAlert();
      await expect(update(id)).rejects.toThrow("alert immutable fields cannot be changed");
    });
  });
});
