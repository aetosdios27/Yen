ALTER TABLE bank_transactions
  ADD COLUMN matched_expense_id uuid REFERENCES expenses(id);

CREATE UNIQUE INDEX bank_transactions_matched_expense_id_key
  ON bank_transactions(matched_expense_id);
