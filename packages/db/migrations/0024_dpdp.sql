CREATE TABLE consent_records (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL CHECK (purpose IN ('account_otp', 'donation_receipt_contact', 'notification_whatsapp', 'notification_sms', 'notification_email')),
  notice_version text NOT NULL,
  granted_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at)
);
CREATE INDEX consent_records_user_purpose_idx ON consent_records(user_id, purpose, granted_at DESC);
CREATE UNIQUE INDEX consent_records_one_active_idx ON consent_records(user_id, purpose)
  WHERE withdrawn_at IS NULL;

CREATE TABLE erasure_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed'))
);
CREATE INDEX erasure_requests_user_idx ON erasure_requests(user_id, requested_at DESC);

ALTER TABLE users ADD COLUMN erased_at timestamptz;
ALTER TABLE users ADD COLUMN retention_required boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN retention_reason text;
ALTER TABLE users ADD CONSTRAINT users_retention_reason_check
  CHECK ((retention_required AND retention_reason IS NOT NULL AND length(trim(retention_reason)) > 0) OR (NOT retention_required AND retention_reason IS NULL));

CREATE TABLE retention_audit (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  fund_id uuid NOT NULL REFERENCES funds(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX retention_audit_user_created_idx ON retention_audit(user_id, created_at DESC);
CREATE INDEX retention_audit_actor_created_idx ON retention_audit(actor_user_id, created_at DESC);
CREATE INDEX retention_audit_fund_created_idx ON retention_audit(fund_id, created_at DESC);

-- Preserve an integrity digest while allowing raw bank-feed identity fields to be scrubbed.
ALTER TABLE bank_transactions ADD COLUMN raw_payload_sha256 text;
UPDATE bank_transactions
SET raw_payload_sha256 = pg_catalog.encode(
  pg_catalog.sha256(pg_catalog.convert_to(raw_payload::text, 'UTF8')), 'hex');
ALTER TABLE bank_transactions ALTER COLUMN raw_payload_sha256 SET NOT NULL;
ALTER TABLE bank_transactions ADD CONSTRAINT bank_transactions_raw_payload_sha256_check
  CHECK (raw_payload_sha256 ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION yen_bank_transactions_protect()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank_transactions rows are immutable and cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.raw_payload_sha256 := pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(NEW.raw_payload::text, 'UTF8')), 'hex');
    RETURN NEW;
  END IF;
  IF OLD.id <> NEW.id OR
     OLD.fund_id <> NEW.fund_id OR
     OLD.bank_reference <> NEW.bank_reference OR
     OLD.amount_paise <> NEW.amount_paise OR
     OLD.type <> NEW.type OR
     OLD.posted_at <> NEW.posted_at OR
     OLD.source <> NEW.source OR
     OLD.raw_payload_sha256 <> NEW.raw_payload_sha256 OR
     (OLD.raw_payload <> NEW.raw_payload AND NEW.raw_payload <> '{"redacted":true}'::jsonb) THEN
    RAISE EXCEPTION 'bank_transactions financial attributes are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER trg_bank_transactions_protect ON bank_transactions;
CREATE TRIGGER trg_bank_transactions_protect
  BEFORE INSERT OR UPDATE OR DELETE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION yen_bank_transactions_protect();
