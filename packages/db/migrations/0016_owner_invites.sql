ALTER TABLE users
  ADD COLUMN assurance text NOT NULL DEFAULT 'otp_verified'
  CHECK (assurance IN ('otp_verified', 'owner_vouched'));

CREATE TABLE owner_invites (
  id uuid PRIMARY KEY,
  fund_id uuid NOT NULL REFERENCES funds(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  member_name text,
  secret_hash text NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (confirmed_at IS NULL OR redeemed_at IS NOT NULL),
  CHECK (completed_at IS NULL OR confirmed_at IS NOT NULL)
);
CREATE INDEX owner_invites_owner_pending_idx ON owner_invites(owner_id, fund_id, created_at DESC)
  WHERE completed_at IS NULL;
CREATE INDEX owner_invites_owner_idx ON owner_invites(owner_id);
CREATE INDEX owner_invites_fund_idx ON owner_invites(fund_id, owner_id, created_at DESC);
