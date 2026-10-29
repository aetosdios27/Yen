CREATE TABLE expenses (
  id uuid PRIMARY KEY,
  fund_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'expired', 'paid', 'reconciled')),
  hold_id text,
  expense_data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX expenses_fund_id_created_at_idx ON expenses (fund_id, created_at DESC);

CREATE TABLE expense_approvals (
  expense_id uuid NOT NULL REFERENCES expenses(id),
  approver_id text NOT NULL,
  approved_at timestamptz NOT NULL,
  approval_data jsonb NOT NULL,
  PRIMARY KEY (expense_id, approver_id)
);

CREATE FUNCTION yen_expense_approvals_no_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'expense_approvals is append-only: UPDATE is forbidden';
END;
$$;

CREATE FUNCTION yen_expense_approvals_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'expense_approvals is append-only: DELETE is forbidden';
END;
$$;

CREATE FUNCTION yen_expense_approvals_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'expense_approvals is append-only: TRUNCATE is forbidden';
END;
$$;

CREATE TRIGGER expense_approvals_no_update
BEFORE UPDATE ON expense_approvals
FOR EACH ROW EXECUTE FUNCTION yen_expense_approvals_no_update();
CREATE TRIGGER expense_approvals_no_delete
BEFORE DELETE ON expense_approvals
FOR EACH ROW EXECUTE FUNCTION yen_expense_approvals_no_delete();
CREATE TRIGGER expense_approvals_no_truncate
BEFORE TRUNCATE ON expense_approvals
FOR EACH STATEMENT EXECUTE FUNCTION yen_expense_approvals_no_truncate();

REVOKE UPDATE, DELETE, TRUNCATE ON expense_approvals FROM PUBLIC;
