ALTER TABLE notification_outbox
  ADD COLUMN provider_message_id text,
  ADD COLUMN cost_reserved boolean NOT NULL DEFAULT false,
  ADD COLUMN provider_status text;

ALTER TABLE notification_outbox
  DROP CONSTRAINT notification_outbox_status_check;
ALTER TABLE notification_outbox
  ADD CONSTRAINT notification_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'sending', 'submitted', 'delivered', 'failed', 'dead_letter', 'skipped'));

CREATE UNIQUE INDEX notification_outbox_provider_message_id_idx
  ON notification_outbox (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE notification_delivery_events (
  provider text NOT NULL CHECK (provider IN ('meta_whatsapp', 'exotel_sms')),
  provider_message_id text NOT NULL,
  provider_status text NOT NULL CHECK (provider_status IN ('delivered', 'dead_letter')),
  event_key text NOT NULL,
  provider_occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, event_key)
);

CREATE INDEX notification_delivery_events_message_time_idx
  ON notification_delivery_events (provider, provider_message_id, provider_occurred_at DESC, received_at DESC);
