-- YEN-31: v2 visibility transition payload. Existing v1 schemas and hashes remain unchanged.
ALTER TABLE fund_events DROP CONSTRAINT fund_events_version_check;
ALTER TABLE fund_events ADD CONSTRAINT fund_events_version_check CHECK (version IN (1, 2));

ALTER FUNCTION yen_validate_event_payload(text, jsonb) RENAME TO yen_validate_event_payload_v1;
CREATE OR REPLACE FUNCTION yen_validate_event_payload(p_type text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_type = 'fund.visibility_changed'
     AND public.yen_has_exact_keys(p_payload, ARRAY['old_visibility', 'new_visibility']) THEN
    IF NOT public.yen_json_string_in(p_payload->'old_visibility', ARRAY['private', 'donors', 'members', 'public'])
       OR NOT public.yen_json_string_in(p_payload->'new_visibility', ARRAY['private', 'donors', 'members', 'public']) THEN
      RAISE EXCEPTION 'Invalid v2 visibility payload: %', p_payload;
    END IF;
    RETURN;
  END IF;
  PERFORM public.yen_validate_event_payload_v1(p_type, p_payload);
END;
$$;

CREATE OR REPLACE FUNCTION yen_fund_events_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_lock_key bigint;
  v_prev_seq bigint;
  v_prev_hash text;
  v_prev_occurred_at text;
  v_canonical_payload text;
  v_expected_envelope text;
  v_computed_hash text;
  v_domain bytea := pg_catalog.convert_to('yen/eventlog/event/v1', 'UTF8') || E'\\x00'::bytea;
BEGIN
  -- (a) Acquire transaction-scoped per-fund advisory lock
  v_lock_key := public.yen_fund_lock_key(NEW.fund_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);

  -- Validate event version
  IF NEW.version NOT IN (1, 2) OR (NEW.version = 2 AND NEW.type != 'fund.visibility_changed') THEN
    RAISE EXCEPTION 'Unsupported event version/type: %/%', NEW.version, NEW.type;
  END IF;

  -- Validate actor pseudonym format
  IF NEW.actor !~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid actor pseudonym format: %', NEW.actor;
  END IF;

  -- Validate occurred_at: UTC millisecond format and a real calendar date and clock time
  IF NOT public.yen_is_utc_millisecond_instant(NEW.occurred_at) THEN
    RAISE EXCEPTION 'Invalid occurred_at (expected a real UTC instant as YYYY-MM-DDTHH:mm:ss.sssZ): %', NEW.occurred_at;
  END IF;

  -- Validate payload against known schema
  IF NEW.version = 1 AND NEW.type = 'fund.visibility_changed'
     AND public.yen_has_exact_keys(NEW.payload, ARRAY['old_visibility', 'new_visibility']) THEN
    RAISE EXCEPTION 'v2 visibility payload requires event version 2';
  END IF;
  PERFORM public.yen_validate_event_payload(NEW.type, NEW.payload);

  -- (b) & (c) Sequence and prev_hash check
  SELECT seq, hash, occurred_at INTO v_prev_seq, v_prev_hash, v_prev_occurred_at
  FROM public.fund_events
  WHERE fund_id = NEW.fund_id
  ORDER BY seq DESC
  LIMIT 1;

  IF v_prev_seq IS NULL THEN
    -- First event for this fund
    IF NEW.seq != 1 THEN
      RAISE EXCEPTION 'First event seq must be 1, got %', NEW.seq;
    END IF;
    IF NEW.prev_hash != '0000000000000000000000000000000000000000000000000000000000000000' THEN
      RAISE EXCEPTION 'First event prev_hash must be 64 zeroes, got %', NEW.prev_hash;
    END IF;
  ELSE
    -- Subsequent event
    IF NEW.seq != v_prev_seq + 1 THEN
      RAISE EXCEPTION 'Event seq gap: expected %, got %', v_prev_seq + 1, NEW.seq;
    END IF;
    IF NEW.prev_hash != v_prev_hash THEN
      RAISE EXCEPTION 'Event prev_hash mismatch: expected %, got %', v_prev_hash, NEW.prev_hash;
    END IF;
    IF NEW.occurred_at < v_prev_occurred_at THEN
      RAISE EXCEPTION 'Event occurred_at moved backwards: previous was %, got %', v_prev_occurred_at, NEW.occurred_at;
    END IF;
  END IF;

  -- Validate canonical payload
  v_canonical_payload := public.yen_canonicalize_jsonb(NEW.payload);

  -- Check payload equality with payload inside canonical_envelope
  BEGIN
    IF (NEW.canonical_envelope::jsonb -> 'payload') IS DISTINCT FROM NEW.payload THEN
      RAISE EXCEPTION 'payload column does not match payload inside canonical_envelope';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'canonical_envelope is not valid JSON or payload mismatch: %', SQLERRM;
  END;

  -- (d) Reconstruct RFC 8785 canonical envelope of exactly the 8 fields
  v_expected_envelope := '{"actor":' || public.yen_canonical_json_string(NEW.actor) ||
                         ',"fund_id":' || public.yen_canonical_json_string(NEW.fund_id::text) ||
                         ',"occurred_at":' || public.yen_canonical_json_string(NEW.occurred_at) ||
                         ',"payload":' || v_canonical_payload ||
                         ',"prev_hash":' || public.yen_canonical_json_string(NEW.prev_hash) ||
                         ',"seq":' || NEW.seq::text ||
                         ',"type":' || public.yen_canonical_json_string(NEW.type) ||
                         ',"version":' || NEW.version::text || '}';

  IF NEW.canonical_envelope != v_expected_envelope THEN
    RAISE EXCEPTION 'canonical_envelope is not RFC 8785 canonical JSON of the unsigned envelope';
  END IF;

  -- Recompute SHA-256 over domain || canonical_envelope
  v_computed_hash := pg_catalog.encode(pg_catalog.sha256(v_domain || pg_catalog.convert_to(NEW.canonical_envelope, 'UTF8')), 'hex');
  IF NEW.hash != v_computed_hash THEN
    RAISE EXCEPTION 'Event hash mismatch: supplied %, computed %', NEW.hash, v_computed_hash;
  END IF;

  RETURN NEW;
END;
$$;

