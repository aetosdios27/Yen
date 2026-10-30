import { createHash } from "node:crypto";
import { type Sql, uuidv7 } from "@yen/db";
import { PRIVACY_NOTICE_VERSION } from "@yen/shared";

export { PRIVACY_NOTICE_VERSION } from "@yen/shared";

export const consentPurposeSchema = [
  "account_otp",
  "donation_receipt_contact",
  "notification_whatsapp",
  "notification_sms",
  "notification_email",
] as const;
export type ConsentPurpose = (typeof consentPurposeSchema)[number];
export interface ConsentRecord {
  readonly purpose: ConsentPurpose;
  readonly notice_version: string;
  readonly granted_at: Date;
  readonly withdrawn_at: Date | null;
}
type MutableConsentRecord = {
  purpose: ConsentPurpose;
  notice_version: string;
  granted_at: Date;
  withdrawn_at: Date | null;
};

export interface ErasureReport {
  readonly dryRun: boolean;
  readonly retained: boolean;
  readonly wouldErase: Readonly<Record<string, number>>;
  readonly wouldRetain: Readonly<Record<string, number>>;
}

export class PrivacyForbiddenError extends Error {}
export class PrivacyNotFoundError extends Error {}
export class PrivacyUnavailableError extends Error {}

export interface PrivacyStore {
  grantConsent(userId: string, purpose: ConsentPurpose, now: number): Promise<void>;
  withdrawConsent(userId: string, purpose: ConsentPurpose, now: number): Promise<boolean>;
  listConsents(userId: string): Promise<readonly ConsentRecord[]>;
  markRetentionRequired(
    actorId: string,
    userId: string,
    fundId: string,
    reason: string,
  ): Promise<void>;
  requestErasure(userId: string, now: number, dryRun: boolean): Promise<ErasureReport>;
}

const notificationColumn: Partial<
  Record<ConsentPurpose, "whatsapp_enabled" | "sms_enabled" | "email_enabled">
> = {
  notification_whatsapp: "whatsapp_enabled",
  notification_sms: "sms_enabled",
  notification_email: "email_enabled",
};
const notificationChannel: Partial<Record<ConsentPurpose, "whatsapp" | "sms" | "email">> = {
  notification_whatsapp: "whatsapp",
  notification_sms: "sms",
  notification_email: "email",
};

export class PostgresPrivacyStore implements PrivacyStore {
  constructor(private readonly sql: Sql) {}

  async grantConsent(userId: string, purpose: ConsentPurpose, now: number) {
    await this.sql.begin(async (tx) => {
      await tx`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await tx`UPDATE consent_records SET withdrawn_at = ${new Date(now)}
        WHERE user_id = ${userId} AND purpose = ${purpose} AND withdrawn_at IS NULL`;
      await tx`INSERT INTO consent_records (id, user_id, purpose, notice_version, granted_at)
        VALUES (${uuidv7()}, ${userId}, ${purpose}, ${PRIVACY_NOTICE_VERSION}, ${new Date(now)})`;
      const column = notificationColumn[purpose];
      const channel = notificationChannel[purpose];
      if (column && channel) {
        await tx.unsafe(
          `INSERT INTO user_notification_preferences (user_id, ${column}, updated_at)
           VALUES ($1, true, $2) ON CONFLICT (user_id) DO UPDATE
           SET ${column} = true, updated_at = EXCLUDED.updated_at`,
          [userId, new Date(now)],
        );
      }
    });
  }

  async withdrawConsent(userId: string, purpose: ConsentPurpose, now: number) {
    return this.sql.begin(async (tx) => {
      await tx`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const rows = await tx`UPDATE consent_records SET withdrawn_at = ${new Date(now)}
        WHERE user_id = ${userId} AND purpose = ${purpose} AND withdrawn_at IS NULL
        RETURNING id`;
      const column = notificationColumn[purpose];
      const channel = notificationChannel[purpose];
      if (column && channel) {
        await tx.unsafe(
          `INSERT INTO user_notification_preferences (user_id, ${column}, updated_at)
           VALUES ($1, false, $2) ON CONFLICT (user_id) DO UPDATE
           SET ${column} = false, updated_at = EXCLUDED.updated_at`,
          [userId, new Date(now)],
        );
        await tx`UPDATE notification_outbox SET status = 'skipped', last_error = 'Consent withdrawn',
          claim_token = NULL, lease_expires_at = NULL, updated_at = ${new Date(now)}
          WHERE user_id = ${userId} AND preferred_channel = ${channel}
            AND status IN ('pending', 'processing')`;
      }
      return rows.length > 0;
    });
  }

  async listConsents(userId: string) {
    return this.sql<ConsentRecord[]>`SELECT purpose, notice_version, granted_at, withdrawn_at
      FROM consent_records WHERE user_id = ${userId} ORDER BY granted_at DESC`;
  }

  async markRetentionRequired(actorId: string, userId: string, fundId: string, reason: string) {
    await this.sql.begin(async (tx) => {
      const ownership = await tx`SELECT 1 FROM funds f JOIN orgs o ON o.id = f.org_id
        JOIN memberships m ON m.fund_id = f.id
        WHERE f.id = ${fundId} AND o.owner_id = ${actorId} AND m.user_id = ${userId}
        LIMIT 1`;
      if (!ownership.length) throw new PrivacyForbiddenError();
      const updated =
        await tx`UPDATE users SET retention_required = true, retention_reason = ${reason}
        WHERE id = ${userId} RETURNING id`;
      if (!updated.length) throw new PrivacyNotFoundError();
      await tx`INSERT INTO retention_audit (id, user_id, actor_user_id, fund_id, reason)
        VALUES (${uuidv7()}, ${userId}, ${actorId}, ${fundId}, ${reason})`;
    });
  }

  async requestErasure(userId: string, now: number, dryRun: boolean): Promise<ErasureReport> {
    return this.sql.begin(async (tx) => {
      const users =
        await tx`SELECT phone, display_name, retention_required FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = users[0];
      if (!user) throw new PrivacyNotFoundError();
      const phone = String(user.phone);
      const displayName = String(user.display_name);
      const retained = Boolean(user.retention_required);
      const fundRows = await tx<{ fund_id: string; salt: Uint8Array }[]>`
        SELECT fund_id, salt FROM display_name_contact_salts`;
      const userPseudonyms = await tx<{ fund_id: string; pseudonym_id: string }[]>`
        SELECT fund_id, pseudonym_id FROM fund_pseudonyms WHERE user_id = ${userId}`;
      const legacyPseudonyms = await tx<{ pseudonym_id: string }[]>`
        SELECT pseudonym_id FROM pseudonyms WHERE user_id = ${userId}`;
      const pseudonymIds = [
        ...new Set([
          ...userPseudonyms.map((row) => row.pseudonym_id),
          ...legacyPseudonyms.map((row) => row.pseudonym_id),
        ]),
      ];
      const publicPseudonyms = pseudonymIds.map((id) => `psn_${id}`);
      const expenses = publicPseudonyms.length
        ? await tx<{ count: number }[]>`
            SELECT count(*)::int AS count FROM expenses
            WHERE expense_data->>'requesterId' = ANY(${publicPseudonyms}::text[])`
        : [{ count: 0 }];
      const approvals = publicPseudonyms.length
        ? await tx<{ count: number }[]>`
            SELECT count(*)::int AS count FROM expense_approvals
            WHERE approver_id = ANY(${publicPseudonyms}::text[])`
        : [{ count: 0 }];
      const events = publicPseudonyms.length
        ? await tx<{ count: number }[]>`
            SELECT count(*)::int AS count FROM fund_events
            WHERE actor = ANY(${publicPseudonyms}::text[])`
        : [{ count: 0 }];
      const fundMemberships = await tx<{ fund_id: string }[]>`
        SELECT fund_id FROM memberships WHERE user_id = ${userId}`;
      const fundIds = [
        ...new Set([
          ...userPseudonyms.map((row) => row.fund_id),
          ...fundMemberships.map((row) => row.fund_id),
        ]),
      ];
      const anchors = fundIds.length
        ? await tx<{ count: number }[]>`
            SELECT count(*)::int AS count FROM anchors WHERE fund_id = ANY(${fundIds}::uuid[])`
        : [{ count: 0 }];
      const contactHashes = fundRows.map((row) => ({
        fund_id: row.fund_id,
        hash: createHash("sha256").update(row.salt).update(phone).digest(),
      }));
      let guestContactHashes = 0;
      for (const item of contactHashes) {
        const found = await tx`SELECT count(*)::int AS count FROM guest_display_names
          WHERE fund_id = ${item.fund_id} AND contact_hash = ${item.hash}`;
        guestContactHashes += Number(found[0]?.count ?? 0);
      }
      const counts = await tx`
        SELECT
          (SELECT count(*)::int FROM display_names d WHERE EXISTS (
             SELECT 1 FROM fund_pseudonyms fp WHERE fp.user_id = ${userId}
               AND fp.fund_id = d.fund_id AND fp.pseudonym_id = d.pseudonym_id)
             OR EXISTS (SELECT 1 FROM pseudonyms p WHERE p.user_id = ${userId} AND p.pseudonym_id = d.pseudonym_id)) AS display_names,
          (SELECT count(*)::int FROM fund_pseudonyms WHERE user_id = ${userId}) AS fund_pseudonyms,
          (SELECT count(*)::int FROM pseudonyms WHERE user_id = ${userId}) AS legacy_pseudonyms,
          (SELECT count(*)::int FROM sessions WHERE user_id = ${userId} AND revoked_at IS NULL) AS sessions,
          (SELECT count(*)::int FROM sessions WHERE user_id = ${userId}) AS all_sessions,
          (SELECT count(*)::int FROM trusted_devices WHERE user_id = ${userId} AND revoked_at IS NULL) AS trusted_devices,
          (SELECT count(*)::int FROM owner_invites WHERE owner_id = ${userId} OR phone = ${phone}) AS invites,
          (SELECT count(*)::int FROM notification_outbox WHERE user_id = ${userId}) AS notifications,
          (SELECT count(*)::int FROM notification_dead_letter WHERE user_id = ${userId}) AS dead_letters,
          (SELECT count(*)::int FROM donation_pledges WHERE donor_contact = ${phone} OR donor_display_name = ${displayName}) AS donation_contacts,
          (SELECT count(*)::int FROM user_notification_preferences WHERE user_id = ${userId}) AS notification_preferences,
          (SELECT count(*)::int FROM bank_transactions WHERE counterparty_name = ${displayName}
             OR counterparty_vpa = ${phone}
             OR narration LIKE '%' || ${phone} || '%' OR narration LIKE '%' || ${displayName} || '%'
             OR manual_match_reason LIKE '%' || ${phone} || '%'
             OR manual_match_reason LIKE '%' || ${displayName} || '%'
             OR raw_payload::text LIKE '%' || ${phone} || '%'
             OR raw_payload::text LIKE '%' || ${displayName} || '%'
             OR manual_match_by = ${userId}) AS bank_records_with_contact,
          (SELECT count(*)::int FROM waitlist_entries WHERE contact = ${phone}) AS waitlist_entries,
          (SELECT count(*)::int FROM rate_limits WHERE position(${userId} in key) > 0) AS rate_limits,
          (SELECT count(*)::int FROM auth_otps WHERE phone = ${phone}) AS auth_otps,
          (SELECT count(*)::int FROM auth_otp_attempt_limits WHERE phone = ${phone}) AS otp_attempt_limits,
          (SELECT count(*)::int FROM user_approval_pins WHERE user_id = ${userId}) AS approval_pins,
          (SELECT count(*)::int FROM yen_ids WHERE user_id = ${userId}) AS yen_ids,
          (SELECT count(*)::int FROM memberships WHERE user_id = ${userId} AND status <> 'removed') AS memberships,
          (SELECT count(*)::int FROM consent_records WHERE user_id = ${userId}) AS consents,
          (SELECT count(*)::int FROM retention_audit WHERE user_id = ${userId}) AS retention_audits`;
      const wouldErase: Record<string, number> = {
        display_names: Number(counts[0]?.display_names ?? 0),
        fund_pseudonyms: Number(counts[0]?.fund_pseudonyms ?? 0),
        legacy_pseudonyms: Number(counts[0]?.legacy_pseudonyms ?? 0),
        guest_contact_hashes: guestContactHashes,
        sessions: Number(counts[0]?.sessions ?? 0),
        trusted_devices: Number(counts[0]?.trusted_devices ?? 0),
        invites: Number(counts[0]?.invites ?? 0),
        notification_outbox: Number(counts[0]?.notifications ?? 0),
        notification_preferences: Number(counts[0]?.notification_preferences ?? 0),
        donation_contacts: Number(counts[0]?.donation_contacts ?? 0),
        bank_records_with_contact: Number(counts[0]?.bank_records_with_contact ?? 0),
        waitlist_entries: Number(counts[0]?.waitlist_entries ?? 0),
        rate_limits: Number(counts[0]?.rate_limits ?? 0),
        expenses: Number(expenses[0]?.count ?? 0),
        auth_otps: Number(counts[0]?.auth_otps ?? 0),
        otp_attempt_limits: Number(counts[0]?.otp_attempt_limits ?? 0),
        approval_pins: Number(counts[0]?.approval_pins ?? 0),
        yen_ids_unlinked: Number(counts[0]?.yen_ids ?? 0),
        memberships_deactivated: Number(counts[0]?.memberships ?? 0),
        session_device_metadata_cleared: Number(counts[0]?.all_sessions ?? 0),
        notification_dead_letters: Number(counts[0]?.dead_letters ?? 0),
        identity: retained ? 1 : 2,
        identity_display_name: 1,
        identity_phone: retained ? 0 : 1,
      };
      const wouldRetain = {
        identity_phone: retained ? 1 : 0,
        consent_history: Number(counts[0]?.consents ?? 0),
        retention_audit_records: Number(counts[0]?.retention_audits ?? 0),
        expense_financial_records: Number(expenses[0]?.count ?? 0),
        expense_approval_records: Number(approvals[0]?.count ?? 0),
        donation_financial_records: Number(counts[0]?.donation_contacts ?? 0),
        bank_financial_records: Number(counts[0]?.bank_records_with_contact ?? 0),
        fund_event_records: Number(events[0]?.count ?? 0),
        anchor_records: Number(anchors[0]?.count ?? 0),
        erasure_audit_records: 1,
      };
      if (dryRun) return { dryRun, retained, wouldErase, wouldRetain };

      const requestId = uuidv7();
      await tx`INSERT INTO erasure_requests (id, user_id, requested_at, completed_at, status)
        VALUES (${requestId}, ${userId}, ${new Date(now)}, ${new Date(now)}, 'completed')`;
      await tx`UPDATE consent_records SET withdrawn_at = ${new Date(now)}
        WHERE user_id = ${userId} AND withdrawn_at IS NULL`;
      await tx`UPDATE sessions SET revoked_at = ${new Date(now)}, user_agent = '',
        device_info = '', ip_address = ''
        WHERE user_id = ${userId} AND revoked_at IS NULL`;
      await tx`UPDATE sessions SET user_agent = '', device_info = '', ip_address = ''
        WHERE user_id = ${userId}`;
      await tx`UPDATE trusted_devices SET revoked_at = ${new Date(now)}
        WHERE user_id = ${userId} AND revoked_at IS NULL`;
      await tx`DELETE FROM notification_dead_letter WHERE user_id = ${userId}`;
      await tx`DELETE FROM notification_outbox WHERE user_id = ${userId}`;
      await tx`DELETE FROM user_notification_preferences WHERE user_id = ${userId}`;
      await tx`DELETE FROM owner_invites WHERE owner_id = ${userId} OR phone = ${phone}`;
      await tx`DELETE FROM user_approval_pins WHERE user_id = ${userId}`;
      // Device credentials are access material. Erasure keeps the users row (it is anonymized,
      // not deleted), so the users FK cascade never fires; remove them explicitly.
      await tx`DELETE FROM device_webauthn_challenges WHERE user_id = ${userId}`;
      await tx`DELETE FROM device_signature_proofs WHERE user_id = ${userId}`;
      await tx`DELETE FROM device_credentials WHERE user_id = ${userId}`;
      await tx`DELETE FROM auth_otps WHERE phone = ${phone}`;
      await tx`DELETE FROM auth_otp_attempt_limits WHERE phone = ${phone}`;
      await tx`DELETE FROM waitlist_entries WHERE contact = ${phone}`;
      await tx`DELETE FROM rate_limits WHERE position(${userId} in key) > 0`;
      await tx`UPDATE donation_pledges SET donor_contact = NULL, donor_display_name = NULL
        WHERE donor_contact = ${phone} OR donor_display_name = ${displayName}`;
      for (const pseudonym of publicPseudonyms) {
        await tx`UPDATE expenses SET expense_data = jsonb_set(
            jsonb_set(jsonb_set(jsonb_set(jsonb_set(expense_data, '{requesterId}', to_jsonb('psn_00000000-0000-7000-8000-000000000000'::text)),
              '{description}', to_jsonb('Removed on erasure'::text)),
            '{recipientRef}', to_jsonb('Removed on erasure'::text)),
            '{payee}', 'null'::jsonb),
            '{payeeFingerprint}', 'null'::jsonb), updated_at = ${new Date(now)}
          WHERE expense_data->>'requesterId' = ${pseudonym}`;
      }
      await tx`UPDATE expenses SET expense_data = jsonb_set(
          jsonb_set(expense_data, '{payee}', 'null'::jsonb),
          '{payeeFingerprint}', 'null'::jsonb), updated_at = ${new Date(now)}
        WHERE expense_data->'payee' IS NOT NULL
          AND (expense_data->'payee'->>'name' = ${displayName}
            OR expense_data->'payee'->>'name' = ${phone}
            OR expense_data->'payee'->'identity'->>'vpa' LIKE '%' || ${phone} || '%')`;
      await tx`UPDATE bank_transactions SET
        narration = CASE WHEN narration LIKE '%' || ${phone} || '%'
          OR narration LIKE '%' || ${displayName} || '%' THEN NULL ELSE narration END,
        counterparty_vpa = CASE WHEN counterparty_vpa = ${phone} THEN NULL ELSE counterparty_vpa END,
        counterparty_name = CASE WHEN counterparty_name = ${displayName} THEN NULL ELSE counterparty_name END,
        manual_match_reason = CASE WHEN manual_match_reason LIKE '%' || ${phone} || '%'
          OR manual_match_reason LIKE '%' || ${displayName} || '%' THEN NULL ELSE manual_match_reason END,
        manual_match_by = CASE WHEN manual_match_by = ${userId} THEN 'deleted-user' ELSE manual_match_by END,
        raw_payload = CASE WHEN raw_payload::text LIKE '%' || ${phone} || '%'
          OR raw_payload::text LIKE '%' || ${displayName} || '%' THEN '{"redacted":true}'::jsonb ELSE raw_payload END
        WHERE counterparty_name = ${displayName} OR counterparty_vpa = ${phone}
          OR narration LIKE '%' || ${phone} || '%' OR narration LIKE '%' || ${displayName} || '%'
          OR manual_match_reason LIKE '%' || ${phone} || '%'
          OR manual_match_reason LIKE '%' || ${displayName} || '%'
          OR raw_payload::text LIKE '%' || ${phone} || '%' OR raw_payload::text LIKE '%' || ${displayName} || '%'
          OR manual_match_by = ${userId}`;
      await tx`DELETE FROM display_names d USING fund_pseudonyms fp
        WHERE fp.user_id = ${userId} AND d.fund_id = fp.fund_id AND d.pseudonym_id = fp.pseudonym_id`;
      await tx`DELETE FROM display_names d USING pseudonyms p
        WHERE p.user_id = ${userId} AND d.pseudonym_id = p.pseudonym_id`;
      for (const item of contactHashes) {
        await tx`DELETE FROM guest_display_names WHERE fund_id = ${item.fund_id}
          AND contact_hash = ${item.hash}`;
      }
      await tx`DELETE FROM fund_pseudonyms WHERE user_id = ${userId}`;
      await tx`DELETE FROM pseudonyms WHERE user_id = ${userId}`;
      await tx`UPDATE yen_ids SET user_id = NULL WHERE user_id = ${userId}`;
      await tx`UPDATE memberships SET status = 'removed' WHERE user_id = ${userId} AND status <> 'removed'`;
      await tx`UPDATE users SET display_name = 'Deleted user', erased_at = ${new Date(now)},
        phone = CASE WHEN retention_required THEN phone
          ELSE '+199' || right(translate(replace(id::text, '-', ''), 'abcdef', '123456'), 12) END
        WHERE id = ${userId}`;
      return { dryRun, retained, wouldErase, wouldRetain };
    });
  }
}

export class MemoryPrivacyStore implements PrivacyStore {
  private readonly consents = new Map<string, MutableConsentRecord[]>();
  async grantConsent(userId: string, purpose: ConsentPurpose, now: number) {
    const rows = (this.consents.get(userId) ?? []).map((row) =>
      row.purpose === purpose && row.withdrawn_at === null
        ? { ...row, withdrawn_at: new Date(now) }
        : row,
    );
    rows.push({
      purpose,
      notice_version: PRIVACY_NOTICE_VERSION,
      granted_at: new Date(now),
      withdrawn_at: null,
    });
    this.consents.set(userId, rows);
  }
  async withdrawConsent(userId: string, purpose: ConsentPurpose, now: number) {
    const rows = this.consents.get(userId) ?? [];
    const index = rows.findLastIndex(
      (item) => item.purpose === purpose && item.withdrawn_at === null,
    );
    if (index < 0) return false;
    const current = rows[index];
    if (!current) return false;
    rows[index] = { ...current, withdrawn_at: new Date(now) };
    this.consents.set(userId, rows);
    return true;
  }
  async listConsents(userId: string) {
    return this.consents.get(userId) ?? [];
  }
  async markRetentionRequired(_actorId: string, _userId: string, _fundId: string, _reason: string) {
    throw new PrivacyForbiddenError();
  }
  async requestErasure(_userId: string, _now: number, _dryRun: boolean): Promise<ErasureReport> {
    throw new PrivacyUnavailableError();
  }
}
