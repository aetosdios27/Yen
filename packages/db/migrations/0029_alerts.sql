CREATE TABLE alerts (
  id uuid PRIMARY KEY,
  fund_id uuid REFERENCES funds(id),
  alert_type text NOT NULL CHECK (alert_type IN (
    'unapproved_debit',
    'balance_drift',
    'chain_verification_failure',
    'anchor_missing',
    'anchor_mismatch',
    'repeated_rejected_requests',
    'spend_rate_spike',
    'integrity_check_failure'
  )),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  details text NOT NULL CHECK (length(trim(details)) > 0),
  entity_type text,
  entity_id text,
  dedup_key text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by text CHECK (acknowledged_by IS NULL OR acknowledged_by ~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  acknowledged_at timestamptz,
  acknowledgement_note text,
  resolved_by text CHECK (resolved_by IS NULL OR resolved_by ~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  resolved_at timestamptz,
  resolution_note text,
  escalated_at timestamptz,
  escalation_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((acknowledged_by IS NULL) = (acknowledged_at IS NULL)),
  CHECK ((resolved_by IS NULL) = (resolved_at IS NULL)),
  CHECK (acknowledged_at IS NULL OR acknowledgement_note IS NOT NULL AND length(trim(acknowledgement_note)) > 0),
  CHECK (resolved_at IS NULL OR resolution_note IS NOT NULL AND length(trim(resolution_note)) > 0),
  CHECK (status = 'open' OR acknowledged_at IS NOT NULL),
  CHECK (status <> 'resolved' OR resolved_at IS NOT NULL)
);

CREATE UNIQUE INDEX alerts_open_dedup_idx
  ON alerts (COALESCE(fund_id::text, ''), alert_type, COALESCE(dedup_key, COALESCE(entity_id, '')))
  WHERE status IN ('open', 'acknowledged');

CREATE INDEX alerts_fund_status_idx ON alerts (fund_id, status, created_at DESC);
CREATE INDEX alerts_escalation_idx ON alerts (escalation_due_at) WHERE status = 'open' AND severity = 'critical';

CREATE FUNCTION yen_alerts_protect() RETURNS trigger
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
CREATE TRIGGER alerts_protect BEFORE UPDATE OR DELETE ON alerts
  FOR EACH ROW EXECUTE FUNCTION yen_alerts_protect();

CREATE FUNCTION yen_alerts_no_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'alerts cannot be truncated';
END;
$$;
CREATE TRIGGER alerts_no_truncate BEFORE TRUNCATE ON alerts
  FOR EACH STATEMENT EXECUTE FUNCTION yen_alerts_no_truncate();

REVOKE DELETE, TRUNCATE ON alerts FROM PUBLIC;
