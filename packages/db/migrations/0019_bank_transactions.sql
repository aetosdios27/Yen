-- Immutable bank transaction records ingested from statements or partner webhooks.
-- Financial transaction details cannot be modified or deleted after insertion.
-- Raw JSON payloads are preserved for auditability.

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY,
  fund_id uuid NOT NULL,
  bank_reference text NOT NULL,
  utr text CHECK (utr IS NULL OR utr ~ '^[0-9]{12}$'),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  type text NOT NULL CHECK (type IN ('credit', 'debit')),
  posted_at timestamptz NOT NULL,
  narration text,
  counterparty_vpa text,
  counterparty_name text,
  source text NOT NULL CHECK (source IN ('statement_upload', 'webhook_partner')),
  raw_payload jsonb NOT NULL,
  reconciliation_status text NOT NULL DEFAULT 'unmatched' CHECK (reconciliation_status IN ('unmatched', 'matched', 'manually_matched', 'ignored')),
  matched_pledge_id uuid REFERENCES donation_pledges(id),
  matched_at timestamptz,
  match_confidence numeric(3, 2) CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
  match_method text CHECK (match_method IS NULL OR match_method IN ('exact_utr', 'heuristic_amount_time', 'manual')),
  manual_match_reason text,
  manual_match_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT bank_transactions_fund_reference_key UNIQUE (fund_id, bank_reference)
);

CREATE INDEX bank_transactions_fund_unmatched_idx
  ON bank_transactions(fund_id, posted_at DESC)
  WHERE reconciliation_status = 'unmatched';

CREATE INDEX bank_transactions_matched_pledge_id_idx
  ON bank_transactions(matched_pledge_id);

CREATE INDEX bank_transactions_utr_idx
  ON bank_transactions(utr)
  WHERE utr IS NOT NULL;

CREATE INDEX bank_transactions_fund_amount_posted_idx
  ON bank_transactions(fund_id, amount_paise, posted_at);

-- Guard trigger to ensure bank_transactions rows cannot be deleted and core financial fields cannot be changed.
CREATE OR REPLACE FUNCTION yen_bank_transactions_protect()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank_transactions rows are immutable and cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.id <> NEW.id OR
       OLD.fund_id <> NEW.fund_id OR
       OLD.bank_reference <> NEW.bank_reference OR
       OLD.amount_paise <> NEW.amount_paise OR
       OLD.type <> NEW.type OR
       OLD.posted_at <> NEW.posted_at OR
       OLD.source <> NEW.source OR
       OLD.raw_payload <> NEW.raw_payload THEN
      RAISE EXCEPTION 'bank_transactions financial attributes are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bank_transactions_protect
  BEFORE UPDATE OR DELETE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION yen_bank_transactions_protect();
