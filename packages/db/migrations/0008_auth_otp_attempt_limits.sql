CREATE TABLE auth_otp_attempt_limits (
  phone text PRIMARY KEY CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  attempts integer NOT NULL CHECK (attempts > 0),
  window_started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
