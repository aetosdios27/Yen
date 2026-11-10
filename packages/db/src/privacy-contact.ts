import { createHash } from "node:crypto";
import type { Sql } from "./client.js";
import { normalizeWaitlistContact } from "./waitlist.js";

/** Operator-only: verify control of the contact before calling; never expose as an anonymous API. */
export async function eraseVerifiedGuestContact(sql: Sql, input: string) {
  const contact = normalizeWaitlistContact(input);
  if (!contact) throw new Error("Invalid contact");
  return sql.begin(async (tx) => {
    const subscriptions =
      await tx`DELETE FROM fund_subscriptions WHERE lower(contact) = ${contact} RETURNING id`;
    const donations =
      await tx`UPDATE donation_pledges SET donor_contact = NULL, donor_display_name = NULL
      WHERE lower(donor_contact) = ${contact} RETURNING id`;
    await tx`DELETE FROM waitlist_entries WHERE lower(contact) = ${contact}`;
    const salts = await tx<
      { fund_id: string; salt: Uint8Array }[]
    >`SELECT fund_id, salt FROM display_name_contact_salts`;
    for (const row of salts) {
      const hash = createHash("sha256").update(row.salt).update(contact).digest();
      await tx`DELETE FROM guest_display_names WHERE fund_id = ${row.fund_id} AND contact_hash = ${hash}`;
    }
    return { subscriptions: subscriptions.length, donations: donations.length };
  });
}
