import { beforeAll, expect, it } from "vitest";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";

databaseSuite("waitlist schema", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });
  it("stores a waitlist entry", async () => {
    await sql`INSERT INTO waitlist_entries (id, name, contact_kind, contact, org, locale, consent_text, consent_version) VALUES (${uuidv7()}, 'A', 'email', 'a@example.com', 'Club', 'en', 'Yes', '1')`;
    expect(await sql`SELECT contact FROM waitlist_entries`).toEqual([{ contact: "a@example.com" }]);
  });
});

databaseSuite("waitlist constraints and deletion", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
  });
  const entry = {
    name: "A",
    contactKind: "email" as const,
    contact: "user@example.com",
    org: "Club",
    locale: "en" as const,
    consentText: "Yes",
    consentVersion: "1",
  };
  it("enforces the checks and contact uniqueness", async () => {
    const insert = (kind: string, contact: string, name = "A") =>
      sql`INSERT INTO waitlist_entries (id, name, contact_kind, contact, org, locale, consent_text, consent_version) VALUES (${uuidv7()}, ${name}, ${kind}, ${contact}, 'Club', 'en', 'Yes', '1')`;
    const invalid: [string, string, string][] = [
      ["other", "a@example.com", "A"],
      ["email", "A@example.com", "A"],
      ["phone", "+91 9876543210", "A"],
      ["email", "a@example.com", "A".repeat(201)],
    ];
    for (const [kind, contact, name] of invalid) {
      await expect(insert(kind, contact, name)).rejects.toMatchObject({ code: "23514" });
    }
    await insert("email", "duplicate@example.com");
    await expect(insert("email", "duplicate@example.com")).rejects.toMatchObject({ code: "23505" });
  });
  it("atomically deduplicates concurrent inserts and deletes by contact", async () => {
    const { createWaitlistEntry, deleteWaitlistEntryByContact, waitlistRowSchema } = await import(
      "./waitlist.js"
    );
    expect(
      await Promise.all([createWaitlistEntry(sql, entry), createWaitlistEntry(sql, entry)]),
    ).toEqual(expect.arrayContaining(["created", "duplicate"]));
    const rows = await sql`SELECT * FROM waitlist_entries WHERE contact = ${entry.contact}`;
    expect(rows).toHaveLength(1);
    expect(waitlistRowSchema.parse(rows[0])).toMatchObject({ contact: entry.contact });
    expect(await createWaitlistEntry(sql, entry)).toBe("duplicate");
    expect(await deleteWaitlistEntryByContact(sql, entry.contact)).toBe(1);
    expect(await deleteWaitlistEntryByContact(sql, entry.contact)).toBe(0);
  });
});
