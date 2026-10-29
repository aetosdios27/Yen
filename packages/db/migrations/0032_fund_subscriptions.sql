CREATE TABLE fund_subscriptions (
  id uuid PRIMARY KEY,
  fund_id uuid NOT NULL REFERENCES funds(id),
  contact text NOT NULL CHECK (char_length(contact) BETWEEN 3 AND 254),
  contact_type text NOT NULL CHECK (contact_type IN ('email', 'phone')),
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'email', 'sms')),
  weekly_summary boolean NOT NULL DEFAULT true,
  instant_alerts boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
  unsubscribe_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unsubscribed_at timestamptz,
  CONSTRAINT fund_subscriptions_fund_contact_key UNIQUE (fund_id, contact)
);

CREATE INDEX fund_subscriptions_fund_id_idx ON fund_subscriptions (fund_id);
CREATE INDEX fund_subscriptions_fund_status_idx ON fund_subscriptions (fund_id, status);
CREATE INDEX fund_subscriptions_token_idx ON fund_subscriptions (unsubscribe_token);

ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_template_id_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_template_id_check
  CHECK (template_id IN ('approval_needed', 'approved_rejected', 'donation_received', 'objection_raised', 'weekly_summary', 'fund_alert', 'large_expense_alert'));
