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
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
