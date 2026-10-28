CREATE TABLE user_approval_pins (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  salt text NOT NULL CHECK (char_length(salt) >= 16),
  pin_hash text NOT NULL CHECK (char_length(pin_hash) >= 20),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  total_failed_24h integer NOT NULL DEFAULT 0 CHECK (total_failed_24h >= 0),
  first_failed_at timestamptz,
  locked_until timestamptz,
  cooling_off_until timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked_out', 'cooling_off')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX user_approval_pins_status_idx ON user_approval_pins(status);
