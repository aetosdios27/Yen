CREATE TABLE auth_otps (
  id uuid PRIMARY KEY,
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  otp_hash text NOT NULL,
  salt text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  expires_at timestamptz NOT NULL,
  resend_available_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX auth_otps_phone_idx ON auth_otps(phone, created_at DESC);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  user_agent text NOT NULL DEFAULT '',
  device_info text NOT NULL DEFAULT '',
  ip_address text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id, created_at DESC);
CREATE INDEX sessions_token_hash_idx ON sessions(token_hash);
