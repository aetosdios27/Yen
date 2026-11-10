-- Public totals only sum outstanding pledges; verified history grows indefinitely.
CREATE INDEX donation_pledges_outstanding_fund_idx
  ON donation_pledges (fund_id) INCLUDE (amount_paise) WHERE status = 'pledged';

ALTER TABLE donation_pledges DROP CONSTRAINT donation_pledges_status_check;
ALTER TABLE donation_pledges ADD CONSTRAINT donation_pledges_status_check CHECK (status IN ('pledged', 'verified', 'rejected', 'refunded'));

-- Replay already treats rejection after verification as a refund; repair the projection only.
UPDATE donation_pledges dp SET status = 'refunded'
WHERE dp.status = 'rejected' AND EXISTS (
  SELECT 1 FROM fund_events r JOIN fund_events v ON v.fund_id = r.fund_id
    AND v.type = 'donation.verified' AND v.payload->>'donation_id' = dp.id::text AND v.seq < r.seq
  WHERE r.fund_id = dp.fund_id AND r.type = 'donation.rejected'
    AND r.payload->>'donation_id' = dp.id::text
);
