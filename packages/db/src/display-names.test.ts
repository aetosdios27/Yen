import { randomUUID } from "node:crypto";
import { chainHead, hashHexSchema, pseudonymIdSchema } from "@yen/eventlog";
import { fundIdSchema, orgIdSchema, userIdSchema } from "@yen/shared";
import { beforeAll, expect, it } from "vitest";
import {
  deleteDisplayName,
  deleteGuestDisplayName,
  displayLabel,
  getDisplayName,
  getGuestDisplayName,
  setDisplayName,
  setGuestDisplayName,
  setOfficeholderNamesShown,
} from "./display-names.js";
import { appendEvent, checkStoredChainStructure, verifyStoredChain } from "./events.js";
import { migrate } from "./migrate.js";
import { databaseSuite } from "./test/database.js";
import { uuidv7 } from "./uuidv7.js";

it("defaults donation labels to initials and supports each explicit choice", () => {
  expect(displayLabel("Asha Rao")).toBe("A. R.");
  expect(displayLabel("Asha Rao", "full")).toBe("Asha Rao");
  expect(displayLabel("Asha Rao", "anonymous")).toBe("A donor");
});

databaseSuite("display-name store", (sql) => {
  beforeAll(async () => migrate(sql));

  it("corrects and deletes a name without changing event bytes or chain verification", async () => {
    const userId = userIdSchema.parse(uuidv7());
    const orgId = orgIdSchema.parse(uuidv7());
    const fundId = fundIdSchema.parse(uuidv7());
    const pseudonymId = randomUUID();
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${`+91${Math.floor(1000000000 + Math.random() * 8999999999)}`}, 'Owner')`;
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Org', 'society', ${userId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Fund', '{}')`;
    await appendEvent(sql, {
      fundId,
      type: "fund.created",
      version: 1,
      actor: pseudonymIdSchema.parse(`psn_${pseudonymId}`),
      occurredAt: "2026-10-29T00:00:00.000Z",
      payload: { org_id: orgId, visibility: "public" },
    });
    const chainBefore = await checkStoredChainStructure(sql, fundId);
    const eventsBefore =
      await sql`SELECT canonical_envelope, hash FROM fund_events WHERE fund_id = ${fundId}`;
    const hashBefore = eventsBefore[0]?.hash;
    if (typeof hashBefore !== "string") throw new Error("Expected event hash");
    const expectedHead = chainHead({
      fundId,
      count: 1,
      latestHash: hashHexSchema.parse(hashBefore),
    });
    expect(await verifyStoredChain(sql, fundId, expectedHead)).toMatchObject({ ok: true });

    await setDisplayName(sql, {
      fundId,
      pseudonymId: `psn_${pseudonymId}`,
      displayName: "Asha Rao",
    });
    expect(await getDisplayName(sql, { fundId, pseudonymId: `psn_${pseudonymId}` })).toBe(
      "Asha Rao",
    );
    await setDisplayName(sql, {
      fundId,
      pseudonymId: `psn_${pseudonymId}`,
      displayName: "Asha R.",
    });
    expect(await getDisplayName(sql, { fundId, pseudonymId: `psn_${pseudonymId}` })).toBe(
      "Asha R.",
    );
    expect(await deleteDisplayName(sql, { fundId, pseudonymId: `psn_${pseudonymId}` })).toBe(true);

    const eventsAfter =
      await sql`SELECT canonical_envelope, hash FROM fund_events WHERE fund_id = ${fundId}`;
    expect(eventsAfter).toEqual(eventsBefore);
    expect(await checkStoredChainStructure(sql, fundId)).toEqual(chainBefore);
    expect(await verifyStoredChain(sql, fundId, expectedHead)).toMatchObject({ ok: true });
  });

  it("stores guest labels by a salted contact hash without putting raw contact in the name table", async () => {
    const userId = userIdSchema.parse(uuidv7());
    const orgId = orgIdSchema.parse(uuidv7());
    const fundId = fundIdSchema.parse(uuidv7());
    const phone = `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`;
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Owner')`;
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, ${`Org-${randomUUID()}`}, 'society', ${userId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Fund', '{}')`;
    const contact = `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`;
    await setGuestDisplayName(sql, { fundId, contact, displayName: "Guest Donor" });
    expect(await getGuestDisplayName(sql, { fundId, contact })).toBe("Guest Donor");
    await setGuestDisplayName(sql, { fundId, contact, displayName: "Guest Donor Corrected" });
    expect(await getGuestDisplayName(sql, { fundId, contact })).toBe("Guest Donor Corrected");
    const stored =
      await sql`SELECT contact_hash FROM guest_display_names WHERE fund_id = ${fundId}`;
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(contact);
    expect(await deleteGuestDisplayName(sql, { fundId, contact })).toBe(true);
    expect(await getGuestDisplayName(sql, { fundId, contact })).toBeNull();
    expect(
      await setOfficeholderNamesShown(sql, { fundId, ownerUserId: randomUUID(), shown: true }),
    ).toBe(false);
    expect(await setOfficeholderNamesShown(sql, { fundId, ownerUserId: userId, shown: true })).toBe(
      true,
    );
    const fund = await sql`SELECT show_officeholder_names FROM funds WHERE id = ${fundId}`;
    expect(fund[0]?.show_officeholder_names).toBe(true);
  });
});
