CREATE INDEX donation_pledges_unverified_age_idx ON donation_pledges(created_at) WHERE status = 'pledged';
CREATE INDEX anchors_confirmed_head_idx ON anchors(fund_id, to_seq DESC) WHERE status = 'confirmed';
