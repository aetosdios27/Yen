import { randomBytes } from "node:crypto";
import { appendEvent, migrate, type Sql, uuidv7, verifyStoredChain } from "@yen/db";
import { chainHead, hashHexSchema, pseudonymIdSchema } from "@yen/eventlog";
import {
  fromHex,
  fundIdSchema,
  hash32,
  leafHash,
  orgIdSchema,
  salt32,
  userIdSchema,
} from "@yen/shared";
import { beforeAll, expect, it } from "vitest";
import { databaseSuite } from "../../../packages/db/src/test/database.js";
import { initLedgerSchema } from "../../../packages/ledger/src/schema.js";
import { PostgresNotificationStore } from "../../../packages/notifications/src/store.js";
import { createApp } from "./app.js";
import { PostgresDonationPledgeStore } from "./donation-store.js";
import { devPolicy } from "./policy.js";
import { PostgresPrivacyStore } from "./privacy-store.js";

async function seedFund(sql: Sql) {
  const ownerId = uuidv7();
  const userId = userIdSchema.parse(uuidv7());
  const orgId = orgIdSchema.parse(uuidv7());
  const fundId = fundIdSchema.parse(uuidv7());
  const pseudonymId = uuidv7();
  const sessionId = uuidv7();
  const phone = `+91${String(Math.floor(1000000000 + Math.random() * 8999999999))}`;
  const ownerPhone = `+91${String(Math.floor(1000000000 + Math.random() * 8999999999))}`;
  await sql`INSERT INTO users (id, phone, display_name) VALUES (${ownerId}, ${ownerPhone}, 'Fund Owner')`;
  await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, ${phone}, 'Sensitive Person Name')`;
  await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgId}, 'Club', 'society', ${ownerId})`;
  await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Fund', '{}')`;
  await sql`INSERT INTO memberships (fund_id, user_id, role, status) VALUES (${fundId}, ${userId}, 'member', 'active')`;
  await sql`INSERT INTO fund_pseudonyms (pseudonym_id, user_id, fund_id) VALUES (${pseudonymId}, ${userId}, ${fundId})`;
  await sql`INSERT INTO display_names (fund_id, pseudonym_id, display_name) VALUES (${fundId}, ${pseudonymId}, 'Sensitive Person Name')`;
  await sql`INSERT INTO expenses (id, fund_id, status, expense_data, created_at, updated_at)
    VALUES (${uuidv7()}, ${fundId}, 'draft', ${sql.json({ requesterId: `psn_${pseudonymId}`, description: "Sensitive Person Name reimbursement", recipientRef: "Sensitive Person Name" })}, now(), now())`;
  const salt = randomBytes(32);
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(salt).update(phone).digest();
  await sql`INSERT INTO display_name_contact_salts (fund_id, salt) VALUES (${fundId}, ${salt})`;
  await sql`INSERT INTO guest_display_names (fund_id, contact_hash, display_name) VALUES (${fundId}, ${hash}, 'Sensitive Person Name')`;
  await sql`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (${sessionId}, ${userId}, ${randomBytes(32).toString("hex")}, now() + interval '1 day')`;
  await sql`INSERT INTO trusted_devices (session_id, user_id, idle_expires_at) VALUES (${sessionId}, ${userId}, now() + interval '1 day')`;
  await sql`INSERT INTO owner_invites (id, fund_id, owner_id, phone, secret_hash, expires_at, created_at)
    VALUES (${uuidv7()}, ${fundId}, ${ownerId}, ${phone}, ${randomBytes(32).toString("hex")}, now() + interval '1 day', now())`;
  await sql`INSERT INTO user_notification_preferences (user_id) VALUES (${userId})`;
  await sql`INSERT INTO notification_outbox (id, fund_id, user_id, idempotency_key, template_id, template_data, preferred_channel)
    VALUES (${uuidv7()}, ${fundId}, ${userId}, ${`idem-${userId}`}, 'donation_received', '{}', 'sms')`;
  await sql`INSERT INTO bank_transactions (id, fund_id, bank_reference, amount_paise, type, posted_at,
    narration, counterparty_name, source, raw_payload)
    VALUES (${uuidv7()}, ${fundId}, ${`bank-${userId}`}, 1000, 'credit', now(),
      ${`payment from ${phone}`}, 'Sensitive Person Name', 'statement_upload',
      ${sql.json({ phone, donor: "Sensitive Person Name" })})`;
  const event = await appendEvent(sql, {
    fundId,
    type: "fund.created",
    version: 1,
    actor: pseudonymIdSchema.parse(`psn_${pseudonymId}`),
    occurredAt: "2026-10-29T00:00:00.000Z",
    payload: { org_id: orgId, visibility: "private" },
  });
  const head = chainHead({ fundId, count: 1, latestHash: hashHexSchema.parse(event.hash) });
  return { ownerId, userId, fundId, phone, head };
}

databaseSuite("privacy erasure operations", (sql) => {
  beforeAll(async () => {
    await migrate(sql);
    await initLedgerSchema(sql);
  });

  it("dry-runs and erases mutable identity while preserving event bytes and verification", async () => {
    const { userId, fundId, phone, head } = await seedFund(sql);
    const store = new PostgresPrivacyStore(sql);
    const app = createApp({
      principal: { id: userId },
      privacyStore: store,
      logger: { log: () => undefined },
    });
    const notifications = new PostgresNotificationStore(sql as never);
    expect(await notifications.getUserPreferences(userId)).toMatchObject({
      whatsapp_enabled: false,
      sms_enabled: false,
      email_enabled: false,
    });
    const grant = await app.request("/v1/privacy/consents", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "privacy-erasure-consent" },
      body: JSON.stringify({ purpose: "notification_sms", action: "grant" }),
    });
    expect(grant.status).toBe(200);
    expect(await notifications.getUserPreferences(userId)).toMatchObject({
      whatsapp_enabled: false,
      sms_enabled: true,
      email_enabled: false,
    });
    const snapshot =
      async () => sql`SELECT fund_id, seq, type, version, actor, occurred_at, payload,
      prev_hash, hash, canonical_envelope FROM fund_events ORDER BY fund_id, seq`;
    const beforeEvents = await snapshot();
    const beforeVerify = await verifyStoredChain(sql, fundId, head);
    const [bankBefore] = await sql`SELECT raw_payload_sha256 FROM bank_transactions
      WHERE bank_reference = ${`bank-${userId}`}`;

    const previewResponse = await app.request("/v1/privacy/erasure-requests", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "privacy-erasure-preview" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      status: string;
      retained: boolean;
      wouldErase: Record<string, number>;
      wouldRetain: Record<string, number>;
    };
    expect(preview).toMatchObject({ status: "preview", retained: false });
    expect(preview.wouldErase).toMatchObject({
      display_names: 1,
      guest_contact_hashes: 1,
      sessions: 1,
      trusted_devices: 1,
      invites: 1,
      notification_outbox: 1,
      bank_records_with_contact: 1,
      expenses: 1,
      identity_phone: 1,
    });
    expect(preview.wouldRetain).toMatchObject({
      consent_history: 1,
      expense_financial_records: 1,
      fund_event_records: 1,
    });
    expect(await snapshot()).toEqual(beforeEvents);

    const result = await app.request("/v1/privacy/erasure-requests", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "privacy-erasure-execute" },
      body: JSON.stringify({ dryRun: false }),
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ status: "completed", retained: false });
    expect(await snapshot()).toEqual(beforeEvents);
    expect(await verifyStoredChain(sql, fundId, head)).toEqual(beforeVerify);
    expect(
      await sql`SELECT phone, display_name, erased_at FROM users WHERE id = ${userId}`,
    ).toMatchObject([
      {
        phone: expect.not.stringMatching(new RegExp(phone.slice(-6))),
        display_name: "Deleted user",
        erased_at: expect.any(Date),
      },
    ]);
    expect(await sql`SELECT * FROM guest_display_names WHERE fund_id = ${fundId}`).toHaveLength(0);
    expect(await sql`SELECT * FROM display_names WHERE fund_id = ${fundId}`).toHaveLength(0);
    const [expense] = await sql`SELECT expense_data FROM expenses WHERE fund_id = ${fundId}`;
    expect(expense?.expense_data).toMatchObject({
      requesterId: "psn_00000000-0000-7000-8000-000000000000",
      description: "Removed on erasure",
      recipientRef: "Removed on erasure",
    });
    expect(await sql`SELECT revoked_at FROM sessions WHERE user_id = ${userId}`).toMatchObject([
      { revoked_at: expect.any(Date) },
    ]);
    expect(
      await sql`SELECT revoked_at FROM trusted_devices WHERE user_id = ${userId}`,
    ).toMatchObject([{ revoked_at: expect.any(Date) }]);
    expect(
      await sql`SELECT * FROM user_notification_preferences WHERE user_id = ${userId}`,
    ).toHaveLength(0);
    expect(await notifications.getUserPreferences(userId)).toMatchObject({
      opted_out: true,
      whatsapp_enabled: false,
      sms_enabled: false,
      email_enabled: false,
    });
    expect(await notifications.getUserContact(userId)).toBeNull();
    expect(await sql`SELECT * FROM notification_outbox WHERE user_id = ${userId}`).toHaveLength(0);
    expect(
      await sql`SELECT withdrawn_at FROM consent_records WHERE user_id = ${userId}`,
    ).toMatchObject([{ withdrawn_at: expect.any(Date) }]);
    const [bankAfter] = await sql`SELECT amount_paise, narration, counterparty_name, raw_payload,
      raw_payload_sha256 FROM bank_transactions WHERE bank_reference = ${`bank-${userId}`}`;
    expect(bankAfter).toMatchObject({
      amount_paise: 1000n,
      narration: null,
      counterparty_name: null,
      raw_payload: { redacted: true },
      raw_payload_sha256: bankBefore?.raw_payload_sha256,
    });
  });

  it("allows only the owning fund owner to set logged retention and keeps minimal identity on erasure", async () => {
    const { ownerId, userId, fundId, phone } = await seedFund(sql);
    const store = new PostgresPrivacyStore(sql);
    const deniedApp = createApp({
      principal: { id: uuidv7() },
      privacyStore: store,
      logger: { log: () => undefined },
    });
    const denied = await deniedApp.request(`/v1/privacy/funds/${fundId}/retention-required`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "retention-denied" },
      body: JSON.stringify({ userId, reason: "Financial records must be kept" }),
    });
    expect(denied.status).toBe(403);
    const ownerApp = createApp({
      principal: { id: ownerId },
      privacyStore: store,
      logger: { log: () => undefined },
    });
    const marked = await ownerApp.request(`/v1/privacy/funds/${fundId}/retention-required`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "retention-owner" },
      body: JSON.stringify({ userId, reason: "Financial records must be kept by the fund" }),
    });
    expect(marked.status).toBe(204);
    await store.requestErasure(userId, Date.now(), false);
    expect(
      await sql`SELECT phone, display_name, retention_required, retention_reason FROM users WHERE id = ${userId}`,
    ).toEqual([
      {
        phone,
        display_name: "Deleted user",
        retention_required: true,
        retention_reason: "Financial records must be kept by the fund",
      },
    ]);
    expect(
      await sql`SELECT actor_user_id, fund_id, reason FROM retention_audit WHERE user_id = ${userId}`,
    ).toEqual([
      {
        actor_user_id: ownerId,
        fund_id: fundId,
        reason: "Financial records must be kept by the fund",
      },
    ]);
  });

  it("records the notice version and immediately disables a withdrawn notification channel", async () => {
    const { userId, fundId } = await seedFund(sql);
    const store = new PostgresPrivacyStore(sql);
    const app = createApp({
      principal: { id: userId },
      privacyStore: store,
      logger: { log: () => undefined },
    });
    const grant = await app.request("/v1/privacy/consents", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "privacy-sms-grant" },
      body: JSON.stringify({ purpose: "notification_sms", action: "grant" }),
    });
    expect(grant.status).toBe(200);
    await sql`INSERT INTO notification_outbox (
      id, fund_id, user_id, idempotency_key, template_id, template_data,
      preferred_channel, status, claim_token, lease_expires_at
    ) VALUES (
      ${uuidv7()}, ${fundId}, ${userId}, ${`claimed-${userId}`}, 'weekly_summary', '{}',
      'sms', 'processing', ${uuidv7()}, now() + interval '1 minute'
    )`;
    expect(
      await sql`SELECT sms_enabled FROM user_notification_preferences WHERE user_id = ${userId}`,
    ).toEqual([{ sms_enabled: true }]);
    const withdrawal = await app.request("/v1/privacy/consents", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "privacy-sms-withdraw" },
      body: JSON.stringify({ purpose: "notification_sms", action: "withdraw" }),
    });
    expect(withdrawal.status).toBe(200);
    expect(
      await sql`SELECT sms_enabled FROM user_notification_preferences WHERE user_id = ${userId}`,
    ).toEqual([{ sms_enabled: false }]);
    expect(
      await sql`SELECT status, claim_token FROM notification_outbox WHERE user_id = ${userId}`,
    ).toEqual([
      { status: "skipped", claim_token: null },
      { status: "skipped", claim_token: null },
    ]);
    const consents = await store.listConsents(userId);
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({
      purpose: "notification_sms",
      notice_version: "2026-10-29",
    });
    expect(consents[0]?.withdrawn_at).toBeInstanceOf(Date);
  });

  it("runs the donation API journey without putting phone, name, or email in logs, events, or Merkle leaves", async () => {
    const userId = uuidv7();
    const orgId = uuidv7();
    await sql`INSERT INTO users (id, phone, display_name) VALUES (${userId}, '+919876543210', 'Account Holder')`;
    const logOutput: string[] = [];
    const app = createApp({
      principal: { id: userId },
      logger: { log: (entry) => logOutput.push(JSON.stringify(entry)) },
      policy: devPolicy,
      donationPledgeStore: new PostgresDonationPledgeStore(sql),
    });
    const fundResponse = await app.request("/v1/funds", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "privacy-fund-create" },
      body: JSON.stringify({
        name: "Community Fund",
        targetPaise: "5000000",
        upiVpa: "club@yenbank",
        upiPayeeName: "Club",
      }),
    });
    expect(fundResponse.status).toBe(201);
    const fundId = fundIdSchema.parse(((await fundResponse.json()) as { id: string }).id);
    await sql`INSERT INTO orgs (id, name, legal_form, owner_id) VALUES (${orgIdSchema.parse(orgId)}, 'Club', 'society', ${userId})`;
    await sql`INSERT INTO funds (id, org_id, title, policy_json) VALUES (${fundId}, ${orgId}, 'Community Fund', '{}')`;

    for (const [utr, donorName, donorContact] of [
      ["123456789012", "Asha Sensitive Name", "+919876543211"],
      ["999888777666", "Email Sensitive Name", "sensitive@example.test"],
    ]) {
      const response = await app.request(`/v1/funds/${fundId}/donations/pledge`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": `privacy-${utr}` },
        body: JSON.stringify({ amountPaise: "10000", utr, donorName, donorContact }),
      });
      expect(response.status).toBe(201);
    }

    const rows = await sql<{ hash: string; canonical_envelope: string }[]>`
      SELECT hash, canonical_envelope FROM fund_events WHERE fund_id = ${fundId} ORDER BY seq`;
    expect(rows).toHaveLength(2);
    const leaves = await Promise.all(
      rows.map((row) => leafHash(salt32(randomBytes(32)), hash32(fromHex(row.hash)))),
    );
    const inspected = JSON.stringify({ logs: logOutput, events: rows, leaves });
    for (const sensitive of [
      "+919876543210",
      "+919876543211",
      "Account Holder",
      "Asha Sensitive Name",
      "Email Sensitive Name",
      "sensitive@example.test",
    ]) {
      expect(inspected).not.toContain(sensitive);
    }
  });
});
