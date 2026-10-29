CREATE UNIQUE INDEX fund_pseudonyms_fund_pseudonym_key
  ON fund_pseudonyms (fund_id, pseudonym_id);

CREATE TABLE member_payee_profiles (
  fund_id uuid NOT NULL REFERENCES funds(id),
  pseudonym_id uuid NOT NULL,
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fund_id, pseudonym_id),
  FOREIGN KEY (fund_id, pseudonym_id)
    REFERENCES fund_pseudonyms(fund_id, pseudonym_id)
);

CREATE TABLE fund_payee_rule_policies (
  fund_id uuid PRIMARY KEY REFERENCES funds(id),
  new_payee_first_payment_paise bigint NOT NULL DEFAULT 100000 CHECK (new_payee_first_payment_paise BETWEEN 1 AND 9007199254740991),
  large_expense_paise bigint NOT NULL DEFAULT 500000 CHECK (large_expense_paise BETWEEN 1 AND 9007199254740991),
  cooling_off_hours integer NOT NULL DEFAULT 24 CHECK (cooling_off_hours BETWEEN 0 AND 8760),
  split_window_hours integer NOT NULL DEFAULT 24 CHECK (split_window_hours BETWEEN 1 AND 8760),
  approval_threshold_paise bigint NOT NULL DEFAULT 1000000 CHECK (approval_threshold_paise BETWEEN 1 AND 9007199254740991),
  velocity_window_hours integer NOT NULL DEFAULT 24 CHECK (velocity_window_hours BETWEEN 1 AND 8760),
  velocity_max_paise bigint NOT NULL DEFAULT 2000000 CHECK (velocity_max_paise BETWEEN 1 AND 9007199254740991),
  blocked_flag_codes text[] NOT NULL DEFAULT ARRAY['self_payment', 'duplicate_invoice', 'duplicate_evidence'],
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ('self_payment' = ANY(blocked_flag_codes)),
  CHECK (blocked_flag_codes <@ ARRAY[
    'new_payee_large_first_payment', 'payee_changed_cooling_off', 'self_payment',
    'split_requests', 'duplicate_invoice', 'duplicate_evidence',
    'gstin_name_mismatch', 'payee_velocity'
  ]::text[])
);

CREATE TABLE expense_payee_evaluations (
  evaluation_id uuid PRIMARY KEY,
  expense_id uuid NOT NULL REFERENCES expenses(id),
  fund_id uuid NOT NULL REFERENCES funds(id),
  payee_fingerprint char(64) NOT NULL CHECK (payee_fingerprint ~ '^[0-9a-f]{64}$'),
  evaluated_at timestamptz NOT NULL,
  UNIQUE (evaluation_id, fund_id, expense_id)
);
CREATE INDEX expense_payee_evaluations_expense_idx
  ON expense_payee_evaluations (expense_id, evaluated_at DESC);
CREATE INDEX expense_payee_evaluations_fund_idx
  ON expense_payee_evaluations (fund_id, evaluated_at DESC);

CREATE TABLE expense_payee_flags (
  evaluation_id uuid NOT NULL,
  fund_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  code text NOT NULL CHECK (code IN (
    'new_payee_large_first_payment', 'payee_changed_cooling_off', 'self_payment',
    'split_requests', 'duplicate_invoice', 'duplicate_evidence',
    'gstin_name_mismatch', 'payee_velocity'
  )),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  PRIMARY KEY (evaluation_id, code),
  UNIQUE (evaluation_id, fund_id, expense_id, code),
  FOREIGN KEY (evaluation_id, fund_id, expense_id)
    REFERENCES expense_payee_evaluations(evaluation_id, fund_id, expense_id)
);

CREATE TABLE expense_payee_acknowledgements (
  acknowledgement_id uuid PRIMARY KEY,
  evaluation_id uuid NOT NULL,
  fund_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  code text NOT NULL,
  actor_pseudonym_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0 AND length(reason) <= 1000),
  acknowledged_at timestamptz NOT NULL,
  UNIQUE (evaluation_id, code),
  FOREIGN KEY (fund_id, actor_pseudonym_id)
    REFERENCES fund_pseudonyms(fund_id, pseudonym_id),
  FOREIGN KEY (evaluation_id, fund_id, expense_id, code)
    REFERENCES expense_payee_flags(evaluation_id, fund_id, expense_id, code)
);
CREATE INDEX expense_payee_acknowledgements_flag_fk_idx
  ON expense_payee_acknowledgements (evaluation_id, fund_id, expense_id, code);
CREATE INDEX expense_payee_acknowledgements_actor_fk_idx
  ON expense_payee_acknowledgements (fund_id, actor_pseudonym_id);

CREATE FUNCTION yen_payee_rule_rows_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'expense_payee_evaluations', 'expense_payee_flags', 'expense_payee_acknowledgements'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_no_update_delete BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yen_payee_rule_rows_immutable()',
      table_name, table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION yen_payee_rule_rows_immutable()',
      table_name, table_name
    );
  END LOOP;
END $$;

REVOKE UPDATE, DELETE, TRUNCATE ON expense_payee_evaluations FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON expense_payee_flags FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON expense_payee_acknowledgements FROM PUBLIC;
REVOKE SELECT ON member_payee_profiles FROM PUBLIC;
