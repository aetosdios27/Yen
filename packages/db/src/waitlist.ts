import { z } from "zod";
import type { Sql } from "./client.js";
import { uuidv7 } from "./uuidv7.js";

export const waitlistEntrySchema = z
  .object({
    name: z.string().min(1).max(200),
    contactKind: z.enum(["email", "phone"]),
    contact: z.string().min(3).max(254),
    org: z.string().min(1).max(200),
    locale: z.enum(["en", "hi"]),
    consentText: z.string().min(1).max(1000),
    consentVersion: z.string().min(1).max(40),
  })
  .strict();
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;
export const waitlistRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contact_kind: z.enum(["email", "phone"]),
  contact: z.string(),
  org: z.string(),
  locale: z.enum(["en", "hi"]),
  consent_text: z.string(),
  consent_version: z.string(),
  created_at: z.date(),
});
export type WaitlistRow = z.infer<typeof waitlistRowSchema>;

export async function createWaitlistEntry(
  sql: Sql,
  entry: WaitlistEntry,
): Promise<"created" | "duplicate"> {
  const result =
    await sql`INSERT INTO waitlist_entries (id, name, contact_kind, contact, org, locale, consent_text, consent_version)
    VALUES (${uuidv7()}, ${entry.name}, ${entry.contactKind}, ${entry.contact}, ${entry.org}, ${entry.locale}, ${entry.consentText}, ${entry.consentVersion})
    ON CONFLICT (contact) DO NOTHING RETURNING id`;
  return result.length === 0 ? "duplicate" : "created";
}

export function normalizeWaitlistContact(input: string): string | null {
  const value = input.trim();
  if (z.email().safeParse(value).success) return value.toLowerCase();
  if (/^\+[1-9][0-9]{7,14}$/.test(value)) return value;
  if (/^[6-9][0-9 -]{9,18}$/.test(value)) {
    const digits = value.replace(/[ -]/g, "");
    if (/^[6-9][0-9]{9}$/.test(digits)) return `+91${digits}`;
  }
  return null;
}

export async function deleteWaitlistEntryByContact(sql: Sql, contact: string): Promise<number> {
  const normalized = normalizeWaitlistContact(contact);
  if (normalized === null) return 0;
  const result = await sql`DELETE FROM waitlist_entries WHERE contact = ${normalized}`;
  return result.count;
}
