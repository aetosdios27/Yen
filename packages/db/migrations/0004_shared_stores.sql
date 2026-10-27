ALTER TABLE idempotency_keys ALTER COLUMN response DROP NOT NULL;
ALTER TABLE idempotency_keys ADD COLUMN token text NOT NULL DEFAULT '';
ALTER TABLE idempotency_keys ADD COLUMN lease_expires_at timestamptz;
ALTER TABLE idempotency_keys ADD COLUMN replay_expires_at timestamptz;
CREATE INDEX idempotency_keys_lease_expires_at_idx ON idempotency_keys(lease_expires_at);
CREATE INDEX idempotency_keys_replay_expires_at_idx ON idempotency_keys(replay_expires_at);

CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  tokens double precision NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_expires_at_idx ON rate_limits(expires_at);
