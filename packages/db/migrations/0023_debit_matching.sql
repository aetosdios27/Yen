ALTER TABLE bank_transactions
  DROP CONSTRAINT bank_transactions_reconciliation_status_check;
ALTER TABLE bank_transactions
  ADD COLUMN matched_expense_id uuid REFERENCES expenses(id),
  ADD COLUMN counterparty_account_fingerprint text,
  ADD CONSTRAINT bank_transactions_reconciliation_status_check
    CHECK (reconciliation_status IN ('unmatched', 'matched', 'manually_matched', 'ignored', 'ambiguous'));

CREATE INDEX bank_transactions_matched_expense_id_idx ON bank_transactions(matched_expense_id);

CREATE OR REPLACE FUNCTION yen_bank_transactions_protect()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank_transactions rows are immutable and cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD.id IS DISTINCT FROM NEW.id OR
    OLD.fund_id IS DISTINCT FROM NEW.fund_id OR
    OLD.bank_reference IS DISTINCT FROM NEW.bank_reference OR
    OLD.utr IS DISTINCT FROM NEW.utr OR
    OLD.amount_paise IS DISTINCT FROM NEW.amount_paise OR
    OLD.type IS DISTINCT FROM NEW.type OR
    OLD.posted_at IS DISTINCT FROM NEW.posted_at OR
    OLD.narration IS DISTINCT FROM NEW.narration OR
    OLD.counterparty_vpa IS DISTINCT FROM NEW.counterparty_vpa OR
    OLD.counterparty_account_fingerprint IS DISTINCT FROM NEW.counterparty_account_fingerprint OR
    OLD.counterparty_name IS DISTINCT FROM NEW.counterparty_name OR
    OLD.source IS DISTINCT FROM NEW.source OR
    OLD.raw_payload IS DISTINCT FROM NEW.raw_payload
  ) THEN
    RAISE EXCEPTION 'bank_transactions financial attributes are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION yen_bank_transactions_no_truncate()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'bank_transactions rows are immutable and cannot be truncated';
END;
$$;
CREATE TRIGGER bank_transactions_no_truncate
  BEFORE TRUNCATE ON bank_transactions FOR EACH STATEMENT
  EXECUTE FUNCTION yen_bank_transactions_no_truncate();

CREATE TABLE unapproved_debits (
  bank_transaction_id uuid PRIMARY KEY REFERENCES bank_transactions(id),
  fund_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolution_reason text,
  resolved_by text CHECK (resolved_by IS NULL OR resolved_by ~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  resolved_at timestamptz,
  CHECK ((resolution_reason IS NULL AND resolved_by IS NULL AND resolved_at IS NULL) OR
         (length(trim(resolution_reason)) > 0 AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);

CREATE TABLE debit_reconciliation_actions (
  id uuid PRIMARY KEY,
  fund_id uuid NOT NULL,
  bank_transaction_id uuid NOT NULL REFERENCES bank_transactions(id),
  action text NOT NULL CHECK (action IN ('manual_match', 'manual_unmatch')),
  expense_id uuid REFERENCES expenses(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  actor_pseudonym text NOT NULL CHECK (actor_pseudonym ~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX debit_reconciliation_actions_bank_transaction_idx
  ON debit_reconciliation_actions(bank_transaction_id, occurred_at);
CREATE INDEX debit_reconciliation_actions_expense_idx ON debit_reconciliation_actions(expense_id);
CREATE FUNCTION yen_debit_reconciliation_actions_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'debit reconciliation actions are immutable';
END;
$$;
CREATE TRIGGER debit_reconciliation_actions_immutable
  BEFORE UPDATE OR DELETE ON debit_reconciliation_actions
  FOR EACH ROW EXECUTE FUNCTION yen_debit_reconciliation_actions_immutable();
CREATE FUNCTION yen_debit_reconciliation_actions_no_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'debit reconciliation actions cannot be truncated';
END;
$$;
CREATE TRIGGER debit_reconciliation_actions_no_truncate BEFORE TRUNCATE
  ON debit_reconciliation_actions FOR EACH STATEMENT
  EXECUTE FUNCTION yen_debit_reconciliation_actions_no_truncate();
REVOKE UPDATE, DELETE, TRUNCATE ON debit_reconciliation_actions FROM PUBLIC;

CREATE INDEX unapproved_debits_fund_open_idx ON unapproved_debits(fund_id, created_at DESC)
  WHERE resolved_at IS NULL;

CREATE FUNCTION yen_unapproved_debits_protect() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'unapproved_debits rows cannot be deleted'; END IF;
  IF OLD.bank_transaction_id <> NEW.bank_transaction_id OR OLD.fund_id <> NEW.fund_id OR
     OLD.created_at <> NEW.created_at OR OLD.resolved_at IS NOT NULL OR
     NEW.resolution_reason IS NULL OR NEW.resolved_by IS NULL OR NEW.resolved_at IS NULL OR
     length(trim(NEW.resolution_reason)) = 0 THEN
    RAISE EXCEPTION 'unapproved_debits rows are immutable except one reasoned resolution';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER unapproved_debits_protect BEFORE UPDATE OR DELETE ON unapproved_debits
  FOR EACH ROW EXECUTE FUNCTION yen_unapproved_debits_protect();
CREATE FUNCTION yen_unapproved_debits_no_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'unapproved_debits rows cannot be truncated';
END;
$$;
CREATE TRIGGER unapproved_debits_no_truncate BEFORE TRUNCATE ON unapproved_debits
  FOR EACH STATEMENT EXECUTE FUNCTION yen_unapproved_debits_no_truncate();
REVOKE UPDATE, DELETE, TRUNCATE ON unapproved_debits FROM PUBLIC;
