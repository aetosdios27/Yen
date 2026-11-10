import { migrate } from "@yen/db";
import { PgBoss } from "pg-boss";
import { expect, it } from "vitest";
import { databaseSuite } from "../../db/src/test/database.js";
import { registerRetention } from "./retention.js";
import { waitFor } from "./test-utils.js";

databaseSuite("scheduled privacy retention", (sql, url) => {
  it("registers a daily job that actually purges expired personal data", async () => {
    await migrate(sql);
    await sql`INSERT INTO waitlist_entries (id, name, contact, contact_kind, org, locale, consent_text, consent_version, created_at)
      VALUES ('00000000-0000-4000-8000-000000000001', 'Expired Person', 'expired@example.test', 'email', 'Club', 'en', 'yes', 'v1', now() - interval '366 days')`;
    const boss = new PgBoss({ connectionString: url });
    boss.on("error", () => {});
    try {
      await boss.start();
      await registerRetention(boss, sql);
      expect(await boss.getSchedules()).toMatchObject([
        { name: "privacy-retention", cron: "0 2 * * *" },
      ]);
      await boss.send("privacy-retention", {});
      await waitFor(async () => {
        const rows = await sql`SELECT id FROM waitlist_entries`;
        return rows.length === 0 ? true : undefined;
      });
    } finally {
      await boss.stop();
    }
  });
});
