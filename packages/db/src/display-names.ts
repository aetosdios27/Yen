import { createHash, randomBytes } from "node:crypto";
import { pseudonymIdSchema } from "@yen/eventlog";
import { parseFundId } from "@yen/shared";
import type { SqlClient } from "./client.js";

export type DonationNameChoice = "full" | "initials" | "anonymous";

function checkedFundId(value: string): string {
  const result = parseFundId(value);
  if (!result.ok) throw new TypeError(`Invalid fundId: ${result.error}`);
  return result.value;
}

function checkedPseudonym(value: string): string {
  return pseudonymIdSchema.parse(value).slice(4);
}

/** Store the canonical label outside the event log, keyed by fund and pseudonym. */
export async function setDisplayName(
  sql: SqlClient,
  input: { fundId: string; pseudonymId: string; displayName: string },
): Promise<void> {
  const fundId = checkedFundId(input.fundId);
  const pseudonymId = checkedPseudonym(input.pseudonymId);
  const label = input.displayName.trim();
  if (label.length < 1 || label.length > 120) throw new TypeError("Invalid display name");
  await sql`
    INSERT INTO display_names (fund_id, pseudonym_id, display_name, updated_at)
    VALUES (${fundId}, ${pseudonymId}, ${label}, CURRENT_TIMESTAMP)
    ON CONFLICT (fund_id, pseudonym_id) DO UPDATE
    SET display_name = EXCLUDED.display_name, updated_at = CURRENT_TIMESTAMP
  `;
}

export async function getDisplayName(
  sql: SqlClient,
  input: { fundId: string; pseudonymId: string },
): Promise<string | null> {
  const fundId = checkedFundId(input.fundId);
  const pseudonymId = checkedPseudonym(input.pseudonymId);
  const rows = await sql<{ display_name: string }[]>`
    SELECT display_name FROM display_names WHERE fund_id = ${fundId} AND pseudonym_id = ${pseudonymId}
  `;
  return rows[0]?.display_name ?? null;
}

export async function deleteDisplayName(
  sql: SqlClient,
  input: { fundId: string; pseudonymId: string },
): Promise<boolean> {
  const fundId = checkedFundId(input.fundId);
  const pseudonymId = checkedPseudonym(input.pseudonymId);
  const result = await sql`
    DELETE FROM display_names WHERE fund_id = ${fundId} AND pseudonym_id = ${pseudonymId}
  `;
  return result.count > 0;
}

function contactHash(contact: string, salt: Uint8Array): Uint8Array {
  return createHash("sha256").update(salt).update(contact).digest();
}

async function guestHash(sql: SqlClient, fundId: string, contact: string): Promise<Uint8Array> {
  await sql`
    INSERT INTO display_name_contact_salts (fund_id, salt)
    VALUES (${fundId}, ${randomBytes(32)}) ON CONFLICT (fund_id) DO NOTHING
  `;
  const rows = await sql<{ salt: Uint8Array }[]>`
    SELECT salt FROM display_name_contact_salts WHERE fund_id = ${fundId}
  `;
  const salt = rows[0]?.salt;
  if (!salt) throw new Error("Display-name contact salt was not created");
  return contactHash(contact, salt);
}

/** Guest contact data is hashed in process and is never inserted into the name table. */
export async function setGuestDisplayName(
  sql: SqlClient,
  input: { fundId: string; contact: string; displayName: string },
): Promise<void> {
  const fundId = checkedFundId(input.fundId);
  const label = input.displayName.trim();
  if (label.length < 1 || label.length > 120 || input.contact.length === 0) {
    throw new TypeError("Invalid guest display name input");
  }
  const hash = await guestHash(sql, fundId, input.contact);
  await sql`
    INSERT INTO guest_display_names (fund_id, contact_hash, display_name, updated_at)
    VALUES (${fundId}, ${hash}, ${label}, CURRENT_TIMESTAMP)
    ON CONFLICT (fund_id, contact_hash) DO UPDATE
    SET display_name = EXCLUDED.display_name, updated_at = CURRENT_TIMESTAMP
  `;
}

export async function getGuestDisplayName(
  sql: SqlClient,
  input: { fundId: string; contact: string },
): Promise<string | null> {
  const fundId = checkedFundId(input.fundId);
  const hash = await guestHash(sql, fundId, input.contact);
  const rows = await sql<{ display_name: string }[]>`
    SELECT display_name FROM guest_display_names WHERE fund_id = ${fundId} AND contact_hash = ${hash}
  `;
  return rows[0]?.display_name ?? null;
}

export async function deleteGuestDisplayName(
  sql: SqlClient,
  input: { fundId: string; contact: string },
): Promise<boolean> {
  const fundId = checkedFundId(input.fundId);
  const hash = await guestHash(sql, fundId, input.contact);
  const result = await sql`
    DELETE FROM guest_display_names WHERE fund_id = ${fundId} AND contact_hash = ${hash}
  `;
  return result.count > 0;
}

/** Only the fund's owning org owner may change this public display setting. */
export async function setOfficeholderNamesShown(
  sql: SqlClient,
  input: { fundId: string; ownerUserId: string; shown: boolean },
): Promise<boolean> {
  const fundId = checkedFundId(input.fundId);
  const rows = await sql`
    UPDATE funds AS f
    SET show_officeholder_names = ${input.shown}
    FROM orgs AS o
    WHERE f.id = ${fundId} AND o.id = f.org_id AND o.owner_id = ${input.ownerUserId}
    RETURNING f.id
  `;
  return rows.length > 0;
}

export async function getOfficeholderNamesShown(
  sql: SqlClient,
  fundIdInput: string,
): Promise<boolean> {
  const fundId = checkedFundId(fundIdInput);
  const rows = await sql<{ show_officeholder_names: boolean }[]>`
    SELECT show_officeholder_names FROM funds WHERE id = ${fundId}
  `;
  return rows[0]?.show_officeholder_names ?? false;
}

export function displayLabel(name: string | null, choice: DonationNameChoice = "initials"): string {
  if (choice === "anonymous" || !name) return "A donor";
  if (choice === "full") return name;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.map((part) => `${part[0]?.toUpperCase()}.`).join(" ") || "A donor";
}
