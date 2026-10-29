CREATE TABLE trusted_devices (
  session_id uuid PRIMARY KEY REFERENCES sessions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  trusted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  idle_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (idle_expires_at >= trusted_at)
);

CREATE INDEX trusted_devices_user_idx
  ON trusted_devices(user_id, last_active_at DESC);
