ALTER TABLE fund_subscriptions
  ADD COLUMN notice_version text,
  ADD COLUMN consent_granted_at timestamptz,
  ADD COLUMN consent_purpose text CHECK (consent_purpose IN ('notification_whatsapp', 'notification_sms', 'notification_email')),
  ADD CONSTRAINT subscription_consent_complete CHECK (
    (notice_version IS NULL AND consent_granted_at IS NULL AND consent_purpose IS NULL)
    OR (notice_version IS NOT NULL AND consent_granted_at IS NOT NULL AND consent_purpose = 'notification_' || channel)
  );

-- Existing subscriptions have no recorded affirmative consent; require a fresh opt-in.
UPDATE fund_subscriptions SET status = 'unsubscribed', unsubscribed_at = CURRENT_TIMESTAMP
WHERE status = 'active';
