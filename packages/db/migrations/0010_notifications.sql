CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY,
  fund_id uuid NOT NULL REFERENCES funds(id),
  user_id uuid NOT NULL REFERENCES users(id),
  event_id text,
  idempotency_key text NOT NULL UNIQUE,
  template_id text NOT NULL CHECK (template_id IN ('approval_needed', 'approved_rejected', 'donation_received', 'objection_raised', 'weekly_summary')),
  template_data jsonb NOT NULL,
  preferred_channel text NOT NULL DEFAULT 'whatsapp' CHECK (preferred_channel IN ('whatsapp', 'sms', 'email')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'dead_letter', 'skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claim_token uuid,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  channel_used text CHECK (channel_used IN ('whatsapp', 'sms', 'email')),
  cost_paise bigint NOT NULL DEFAULT 0 CHECK (cost_paise >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX notification_outbox_poll_idx ON notification_outbox (status, next_attempt_at) WHERE status IN ('pending', 'processing');
CREATE INDEX notification_outbox_fund_created_idx ON notification_outbox (fund_id, created_at);
CREATE INDEX notification_outbox_user_id_idx ON notification_outbox (user_id);

CREATE TABLE user_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  whatsapp_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  opted_out boolean NOT NULL DEFAULT false,
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'hi')),
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start text CHECK (quiet_hours_start IS NULL OR quiet_hours_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_hours_end text CHECK (quiet_hours_end IS NULL OR quiet_hours_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fund_notification_daily_usage (
  fund_id uuid NOT NULL REFERENCES funds(id),
  usage_date date NOT NULL,
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  total_cost_paise bigint NOT NULL DEFAULT 0 CHECK (total_cost_paise >= 0),
  cap_count integer NOT NULL DEFAULT 100 CHECK (cap_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fund_id, usage_date)
);

CREATE TABLE notification_dead_letter (
  id uuid PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notification_outbox(id),
  fund_id uuid NOT NULL REFERENCES funds(id),
  user_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL,
  template_id text NOT NULL,
  template_data jsonb NOT NULL,
  attempts integer NOT NULL,
  last_error text NOT NULL,
  cost_paise bigint NOT NULL DEFAULT 0 CHECK (cost_paise >= 0),
  dead_lettered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX notification_dead_letter_fund_idx ON notification_dead_letter (fund_id, dead_lettered_at);
CREATE INDEX notification_dead_letter_notification_id_idx ON notification_dead_letter (notification_id);
CREATE INDEX notification_dead_letter_user_id_idx ON notification_dead_letter (user_id);
