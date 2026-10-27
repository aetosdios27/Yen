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

databaseSuite("waitlist Unicode database bounds", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });
  it("accepts 200 astral characters and rejects 201 at both API and database boundaries", async () => {
    const { createApp } = await import("./app.js");
    const app = createApp({
      waitlistStore: new PostgresWaitlistStore(sql),
      logger: { log: () => undefined },
      waitlistMinResponseMs: 0,
    });
    const body = {
      name: "😀".repeat(200),
      contact: "emoji@example.com",
      org: "Club",
      locale: "en",
      consent: { accepted: true, text: "Yes", version: "1" },
    };
    const post = (value: unknown) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    expect((await app.request("/v1/waitlist", post(body))).status).toBe(201);
    expect(
      (await app.request("/v1/waitlist", post({ ...body, name: "😀".repeat(201) }))).status,
    ).toBe(400);
    await expect(
      sql`UPDATE waitlist_entries SET name = ${"😀".repeat(201)} WHERE contact = 'emoji@example.com'`,
    ).rejects.toMatchObject({ code: "23514" });
  });
});

databaseSuite("database readiness", (sql) => {
  it("reports a missing table and recovers after migration", async () => {
    const { databaseReady } = await import("./database-ready.js");
    const { createApp } = await import("./app.js");
    const app = createApp({
      readiness: () => databaseReady(sql),
      logger: { log: () => undefined },
    });
    expect((await app.request("/ready")).status).toBe(503);
    await migrate(sql);
    expect((await app.request("/ready")).status).toBe(200);
    await sql`DROP TABLE waitlist_entries`;
    expect((await app.request("/ready")).status).toBe(503);
  });
});
