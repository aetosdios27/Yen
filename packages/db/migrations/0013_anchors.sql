CREATE TABLE anchors (
  id uuid PRIMARY KEY,
  fund_id uuid NOT NULL REFERENCES funds(id),
  from_seq bigint NOT NULL CHECK (from_seq >= 1),
  to_seq bigint NOT NULL CHECK (to_seq >= from_seq),
  root text NOT NULL CHECK (root ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
  tx_hash text CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  chain_sequence bigint NOT NULL UNIQUE CHECK (chain_sequence > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (fund_id, from_seq, to_seq)
);
CREATE INDEX anchors_fund_id_idx ON anchors(fund_id);
CREATE INDEX anchors_status_idx ON anchors(status);

CREATE TABLE anchor_event_salts (
  anchor_id uuid NOT NULL REFERENCES anchors(id),
  fund_id uuid NOT NULL,
  seq bigint NOT NULL,
  salt text NOT NULL CHECK (salt ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (anchor_id, seq)
);

CREATE FUNCTION yen_anchors_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
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
    AND NOT (OLD.status = 'failed' AND NEW.status = 'submitted') THEN
    RAISE EXCEPTION 'anchor transaction hash may only be set on submission';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER anchors_immutable BEFORE UPDATE OR DELETE ON anchors
FOR EACH ROW EXECUTE FUNCTION yen_anchors_immutable();

CREATE FUNCTION yen_anchor_salts_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'anchor event salts are immutable';
END $$;
CREATE TRIGGER anchor_event_salts_immutable BEFORE UPDATE OR DELETE ON anchor_event_salts
FOR EACH ROW EXECUTE FUNCTION yen_anchor_salts_immutable();
