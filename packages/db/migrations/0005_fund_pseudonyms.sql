-- The pseudonyms table is deprecated and unused; superseded by fund_pseudonyms (one pseudonym per person per fund).
COMMENT ON TABLE pseudonyms IS 'Deprecated: superseded by fund_pseudonyms; unused.';

CREATE TABLE fund_pseudonyms (
  pseudonym_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  fund_id uuid NOT NULL REFERENCES funds(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fund_id)
);
CREATE INDEX fund_pseudonyms_fund_id_idx ON fund_pseudonyms(fund_id);
