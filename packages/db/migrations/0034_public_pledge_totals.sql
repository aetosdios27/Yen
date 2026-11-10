-- Public totals only sum outstanding pledges; verified history grows indefinitely.
CREATE INDEX donation_pledges_outstanding_fund_idx
  ON donation_pledges (fund_id) INCLUDE (amount_paise) WHERE status = 'pledged';
