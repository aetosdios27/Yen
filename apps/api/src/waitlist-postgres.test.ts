import { migrate } from "@yen/db";
import { beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { PostgresWaitlistStore } from "./waitlist-store.js";

databaseSuite("Postgres waitlist store", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });
  it("deduplicates sequential and concurrent submissions", async () => {
    const store = new PostgresWaitlistStore(sql);
    const entry = {
      name: "A",
      contactKind: "email" as const,
      contact: "a@example.com",
      org: "Club",
      locale: "en" as const,
      consentText: "Yes",
      consentVersion: "1",
    };
    expect(await store.add(entry)).toBe("created");
    expect(await store.add(entry)).toBe("duplicate");
    const concurrent = { ...entry, contact: "b@example.com" };
    expect((await Promise.all([store.add(concurrent), store.add(concurrent)])).sort()).toEqual([
      "created",
      "duplicate",
    ]);
    expect(
      await sql`SELECT contact FROM waitlist_entries WHERE contact = ${concurrent.contact}`,
    ).toHaveLength(1);
  });
});
