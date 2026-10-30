-- Alert notifications are delivered through the existing notifications outbox.
-- A new template id is registered so raise/escalation can enqueue owner/approver
-- WhatsApp/SMS messages without bypassing the consent-checked delivery worker.
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_template_id_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_template_id_check
  CHECK (template_id IN ('approval_needed', 'approved_rejected', 'donation_received', 'objection_raised', 'weekly_summary', 'fund_alert'));
