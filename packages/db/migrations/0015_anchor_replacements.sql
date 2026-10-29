ALTER TABLE anchors ADD COLUMN confirmed_at timestamptz;
UPDATE anchors SET confirmed_at = created_at WHERE status = 'confirmed';

CREATE OR REPLACE FUNCTION yen_anchors_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.fund_id <> NEW.fund_id OR OLD.from_seq <> NEW.from_seq
    OR OLD.to_seq <> NEW.to_seq OR OLD.root <> NEW.root OR OLD.chain_id <> NEW.chain_id THEN
    RAISE EXCEPTION 'anchor identity and commitment are immutable';
  END IF;
  IF NOT (
    OLD.status = NEW.status OR
    (OLD.status = 'pending' AND NEW.status IN ('submitted', 'failed')) OR
    (OLD.status = 'submitted' AND NEW.status IN ('confirmed', 'failed')) OR
    (OLD.status = 'failed' AND NEW.status IN ('pending', 'submitted'))
  ) THEN RAISE EXCEPTION 'invalid anchor status transition: % -> %', OLD.status, NEW.status; END IF;
  IF OLD.tx_hash IS DISTINCT FROM NEW.tx_hash AND NOT (OLD.status = 'pending' AND NEW.status = 'submitted')
    AND NOT (OLD.status = 'failed' AND NEW.status = 'submitted')
    AND NOT (OLD.status = 'submitted' AND NEW.status = 'submitted') THEN
    RAISE EXCEPTION 'anchor transaction hash may only be set on submission or fee replacement';
  END IF;
  IF OLD.confirmed_at IS DISTINCT FROM NEW.confirmed_at
    AND NOT (OLD.confirmed_at IS NULL AND NEW.status = 'confirmed' AND NEW.confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'anchor confirmation time is immutable';
  END IF;
  RETURN NEW;
END $$;
