-- A self-reported UPI payment. Nothing here is spendable until a bank statement
-- confirms it, so these rows stay in `pledged` and never touch the fund balance.
-- fund_id has no foreign key yet: funds are still process-local stubs.
CREATE TABLE donation_pledges (
  id uuid PRIMARY KEY,
  fund_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  utr text NOT NULL CHECK (utr ~ '^[0-9]{12}$'),
  donor_display_name text CHECK (char_length(donor_display_name) BETWEEN 1 AND 60),
  donor_contact text CHECK (char_length(donor_contact) BETWEEN 3 AND 254),
  status text NOT NULL DEFAULT 'pledged' CHECK (status IN ('pledged', 'verified', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at timestamptz,
  -- One payment reference can only be claimed once, across every fund.
  CONSTRAINT donation_pledges_utr_key UNIQUE (utr)
);

CREATE INDEX donation_pledges_fund_id_created_at_idx
  ON donation_pledges(fund_id, created_at DESC);
