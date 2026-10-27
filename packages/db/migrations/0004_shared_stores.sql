ALTER TABLE idempotency_keys ALTER COLUMN response DROP NOT NULL;
ALTER TABLE idempotency_keys ADD COLUMN token text NOT NULL DEFAULT '';
ALTER TABLE idempotency_keys ADD COLUMN lease_expires_at timestamptz;
ALTER TABLE idempotency_keys ADD COLUMN replay_expires_at timestamptz;

UPDATE idempotency_keys
SET replay_expires_at = created_at + interval '24 hours'
WHERE response IS NOT NULL AND replay_expires_at IS NULL;

UPDATE idempotency_keys
SET lease_expires_at = created_at + interval '30 seconds'
WHERE response IS NULL AND lease_expires_at IS NULL;

CREATE INDEX idempotency_keys_lease_expires_at_idx ON idempotency_keys(lease_expires_at);
CREATE INDEX idempotency_keys_replay_expires_at_idx ON idempotency_keys(replay_expires_at);

CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  tokens double precision NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_expires_at_idx ON rate_limits(expires_at);
