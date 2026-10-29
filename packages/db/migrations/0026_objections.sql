CREATE TABLE expense_objections (
  id uuid PRIMARY KEY,
  expense_id uuid NOT NULL REFERENCES expenses(id),
  fund_id uuid NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (expense_id, actor_id),
  UNIQUE (expense_id, actor_id, idempotency_key)
);
CREATE INDEX expense_objections_expense_id_idx ON expense_objections (expense_id);
CREATE INDEX expense_objections_fund_id_created_at_idx ON expense_objections (fund_id, created_at DESC);

CREATE TABLE expense_objection_resolutions (
  objection_id uuid PRIMARY KEY REFERENCES expense_objections(id),
  actor_id text NOT NULL,
  resolution text NOT NULL CHECK (resolution IN ('upheld', 'dismissed')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL
);
CREATE INDEX expense_objection_resolutions_objection_id_idx ON expense_objection_resolutions (objection_id);

DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef('public.yen_fund_events_before_insert()'::regprocedure)
  INTO definition;
  definition := replace(
    definition,
    'IF NEW.version NOT IN (1, 2) OR (NEW.version = 2 AND NEW.type != ''fund.visibility_changed'') THEN',
    'IF NEW.version NOT IN (1, 2) OR (NEW.version = 2 AND NEW.type NOT IN (''fund.visibility_changed'', ''expense.objection_raised'')) THEN'
  );
  IF position('expense.objection_raised' IN definition) = 0 THEN
    RAISE EXCEPTION 'Could not extend fund event trigger for objection event version 2';
  END IF;
  EXECUTE definition;
END;
$$;

CREATE FUNCTION yen_expense_objections_no_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'expense objection records are append-only'; END;
$$;
CREATE TRIGGER expense_objections_no_update BEFORE UPDATE ON expense_objections
FOR EACH ROW EXECUTE FUNCTION yen_expense_objections_no_mutation();
CREATE TRIGGER expense_objections_no_delete BEFORE DELETE ON expense_objections
FOR EACH ROW EXECUTE FUNCTION yen_expense_objections_no_mutation();
CREATE TRIGGER expense_objections_no_truncate BEFORE TRUNCATE ON expense_objections
FOR EACH STATEMENT EXECUTE FUNCTION yen_expense_objections_no_mutation();
CREATE TRIGGER expense_objection_resolutions_no_update BEFORE UPDATE ON expense_objection_resolutions
FOR EACH ROW EXECUTE FUNCTION yen_expense_objections_no_mutation();
CREATE TRIGGER expense_objection_resolutions_no_delete BEFORE DELETE ON expense_objection_resolutions
FOR EACH ROW EXECUTE FUNCTION yen_expense_objections_no_mutation();
CREATE TRIGGER expense_objection_resolutions_no_truncate BEFORE TRUNCATE ON expense_objection_resolutions
FOR EACH STATEMENT EXECUTE FUNCTION yen_expense_objections_no_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON expense_objections, expense_objection_resolutions FROM PUBLIC;
