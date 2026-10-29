CREATE TABLE device_credentials (
  credential_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX device_credentials_user_idx
  ON device_credentials(user_id, created_at DESC);
CREATE INDEX device_credentials_active_user_idx
  ON device_credentials(user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE device_webauthn_challenges (
  challenge text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('registration', 'assertion')),
  action_hash char(64),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK ((purpose = 'assertion') = (action_hash IS NOT NULL)),
  CHECK (expires_at > created_at)
);

CREATE INDEX device_webauthn_challenges_expiry_idx
  ON device_webauthn_challenges(expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX device_webauthn_challenges_user_idx
  ON device_webauthn_challenges(user_id);

CREATE TABLE device_signature_proofs (
  proof_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_hash char(64) NOT NULL,
  credential_id_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX device_signature_proofs_expiry_idx
  ON device_signature_proofs(expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX device_signature_proofs_user_idx
  ON device_signature_proofs(user_id);

ALTER TABLE expense_approvals
  ADD COLUMN device_signature_present boolean NOT NULL DEFAULT false,
  ADD COLUMN credential_id_hash char(64),
  ADD CONSTRAINT expense_approvals_device_signature_check CHECK (
    (device_signature_present AND credential_id_hash IS NOT NULL)
    OR (NOT device_signature_present AND credential_id_hash IS NULL)
  );
