CREATE TABLE alert_events (
  id uuid PRIMARY KEY,
  alert_id uuid NOT NULL REFERENCES alerts(id),
  fund_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('acknowledged', 'resolved', 'escalated')),
  actor_pseudonym text NOT NULL CHECK (actor_pseudonym ~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  note text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX alert_events_alert_id_idx ON alert_events (alert_id, created_at DESC);

CREATE FUNCTION yen_alert_events_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'alert_events are append-only';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'alert_events cannot be truncated';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER alert_events_no_update BEFORE UPDATE ON alert_events
  FOR EACH ROW EXECUTE FUNCTION yen_alert_events_append_only();
CREATE TRIGGER alert_events_no_delete BEFORE DELETE ON alert_events
  FOR EACH ROW EXECUTE FUNCTION yen_alert_events_append_only();
CREATE TRIGGER alert_events_no_truncate BEFORE TRUNCATE ON alert_events
  FOR EACH STATEMENT EXECUTE FUNCTION yen_alert_events_append_only();
REVOKE UPDATE, DELETE, TRUNCATE ON alert_events FROM PUBLIC;

-- Block reopening resolved alerts.
CREATE OR REPLACE FUNCTION yen_alerts_protect() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'alerts cannot be deleted, only resolved';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.id IS DISTINCT FROM NEW.id OR
       OLD.fund_id IS DISTINCT FROM NEW.fund_id OR
       OLD.alert_type IS DISTINCT FROM NEW.alert_type OR
       OLD.severity IS DISTINCT FROM NEW.severity OR
       OLD.title IS DISTINCT FROM NEW.title OR
       OLD.details IS DISTINCT FROM NEW.details OR
       OLD.entity_type IS DISTINCT FROM NEW.entity_type OR
       OLD.entity_id IS DISTINCT FROM NEW.entity_id OR
       OLD.dedup_key IS DISTINCT FROM NEW.dedup_key OR
       OLD.created_at IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'alert immutable fields cannot be changed';
    END IF;
    IF OLD.status = 'resolved' AND NEW.status IS DISTINCT FROM 'resolved' THEN
      RAISE EXCEPTION 'resolved alert cannot be reopened';
    END IF;
    IF OLD.resolved_at IS NOT NULL AND NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN
      RAISE EXCEPTION 'alert already resolved';
    END IF;
    IF NEW.status = 'resolved' AND (NEW.resolution_note IS NULL OR length(trim(NEW.resolution_note)) = 0) THEN
      RAISE EXCEPTION 'resolution requires a note';
    END IF;
    IF NEW.status = 'acknowledged' AND (NEW.acknowledgement_note IS NULL OR length(trim(NEW.acknowledgement_note)) = 0) THEN
      RAISE EXCEPTION 'acknowledgement requires a note';
    END IF;
  END IF;
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
