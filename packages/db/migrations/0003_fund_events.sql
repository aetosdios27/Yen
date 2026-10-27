-- Expected application role: yen_app (or whichever non-superuser role the API runs as).
-- Direct UPDATE, DELETE, and TRUNCATE are revoked from PUBLIC and rejected by triggers.
-- RFC 8785 canonicalization and domain-separated SHA-256 verification are database-enforced.
--
-- Primary documentation references:
-- - RFC 8785 JSON Canonicalization Scheme (JCS): https://www.rfc-editor.org/rfc/rfc8785
--   (Section 3.2.3 UTF-16 code unit key ordering; Section 3.2.2.2 string escaping; Section 3.2.2.3 numbers)
-- - PostgreSQL 16 Advisory Locks: https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS
--   (pg_advisory_xact_lock(bigint) holds exclusive lock until transaction commit/rollback)
-- - PostgreSQL 16 Binary String Functions: https://www.postgresql.org/docs/16/functions-binarystring.html
--   (Built-in sha256(bytea) -> bytea)

CREATE TABLE fund_events (
  fund_id uuid NOT NULL REFERENCES funds(id),
  seq bigint NOT NULL CHECK (seq >= 1),
  type text NOT NULL,
  version integer NOT NULL CHECK (version = 1),
  actor text NOT NULL CHECK (actor ~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  occurred_at text NOT NULL CHECK (occurred_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'),
  payload jsonb NOT NULL,
  prev_hash text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  canonical_envelope text NOT NULL,
  PRIMARY KEY (fund_id, seq)
);

CREATE OR REPLACE FUNCTION yen_fund_lock_key(p_fund_id uuid)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (('x' || substr(replace(p_fund_id::text, '-', ''), 1, 16))::bit(64) #
          ('x' || substr(replace(p_fund_id::text, '-', ''), 17, 16))::bit(64))::bigint;
$$;

CREATE OR REPLACE FUNCTION yen_utf16_sort_key(s text)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  len int;
  res bytea := ''::bytea;
  i int;
  cp int;
  hi int;
  lo int;
BEGIN
  IF s IS NULL THEN
    RETURN NULL;
  END IF;
  len := length(s);
  FOR i IN 1..len LOOP
    cp := ascii(substr(s, i, 1));
    IF cp <= 65535 THEN
      res := res || set_byte(set_byte(E'\\000\\000'::bytea, 0, cp >> 8), 1, cp & 255);
    ELSE
      hi := 55296 + ((cp - 65536) >> 10);
      lo := 56320 + ((cp - 65536) & 1023);
      res := res || set_byte(set_byte(set_byte(set_byte(E'\\000\\000\\000\\000'::bytea, 0, hi >> 8), 1, hi & 255), 2, lo >> 8), 3, lo & 255);
    END IF;
  END LOOP;
  RETURN res;
END;
$$;

CREATE OR REPLACE FUNCTION yen_canonical_json_string(s text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  len int;
  i int;
  ch text;
  cp int;
  res text := '"';
BEGIN
  IF s IS NULL THEN
    RETURN 'null';
  END IF;
  len := length(s);
  FOR i IN 1..len LOOP
    ch := substr(s, i, 1);
    cp := ascii(ch);
    IF cp = 34 THEN
      res := res || '\"';
    ELSIF cp = 92 THEN
      res := res || '\\';
    ELSIF cp = 8 THEN
      res := res || '\b';
    ELSIF cp = 9 THEN
      res := res || '\t';
    ELSIF cp = 10 THEN
      res := res || '\n';
    ELSIF cp = 12 THEN
      res := res || '\f';
    ELSIF cp = 13 THEN
      res := res || '\r';
    ELSIF cp < 32 THEN
      res := res || '\u00' || lpad(to_hex(cp), 2, '0');
    ELSE
      res := res || ch;
    END IF;
  END LOOP;
  RETURN res || '"';
END;
$$;

CREATE OR REPLACE FUNCTION yen_es_number(val numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  s text;
  sign text := '';
  mag numeric := abs(val);
  exp_val int := 0;
  mantissa numeric;
  exp_str text;
BEGIN
  IF val = 0 THEN
    RETURN '0';
  END IF;
  IF val < 0 THEN
    sign := '-';
  END IF;
  IF mag >= 0.000001 AND mag < 1000000000000000000000::numeric THEN
    s := trim(trailing '.' from trim(trailing '0' from to_char(mag, 'FM999999999999999999990.09999999999999999999')));
    RETURN sign || s;
  END IF;
  exp_val := floor(log(mag));
  mantissa := mag / (10::numeric ^ exp_val);
  IF mantissa >= 10 THEN
    mantissa := mantissa / 10;
    exp_val := exp_val + 1;
  ELSIF mantissa < 1 THEN
    mantissa := mantissa * 10;
    exp_val := exp_val - 1;
  END IF;
  s := trim(trailing '.' from trim(trailing '0' from to_char(mantissa, 'FM990.09999999999999999999')));
  IF exp_val >= 0 THEN
    exp_str := '+' || exp_val::text;
  ELSE
    exp_str := exp_val::text;
  END IF;
  RETURN sign || s || 'e' || exp_str;
END;
$$;

CREATE OR REPLACE FUNCTION yen_canonicalize_jsonb(val jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_type text := jsonb_typeof(val);
  res text;
  elem jsonb;
  k text;
  v jsonb;
  first_item boolean := true;
BEGIN
  IF v_type = 'null' OR val IS NULL THEN
    RETURN 'null';
  ELSIF v_type = 'boolean' THEN
    IF (val = 'true'::jsonb) THEN
      RETURN 'true';
    ELSE
      RETURN 'false';
    END IF;
  ELSIF v_type = 'string' THEN
    RETURN yen_canonical_json_string(val #>> '{}');
  ELSIF v_type = 'number' THEN
    RETURN yen_es_number((val #>> '{}')::numeric);
  ELSIF v_type = 'array' THEN
    res := '[';
    FOR elem IN SELECT value FROM jsonb_array_elements(val) LOOP
      IF NOT first_item THEN
        res := res || ',';
      ELSE
        first_item := false;
      END IF;
      res := res || yen_canonicalize_jsonb(elem);
    END LOOP;
    RETURN res || ']';
  ELSIF v_type = 'object' THEN
    res := '{';
    FOR k, v IN
      SELECT key, value
      FROM jsonb_each(val)
      ORDER BY yen_utf16_sort_key(key)
    LOOP
      IF NOT first_item THEN
        res := res || ',';
      ELSE
        first_item := false;
      END IF;
      res := res || yen_canonical_json_string(k) || ':' || yen_canonicalize_jsonb(v);
    END LOOP;
    RETURN res || '}';
  ELSE
    RAISE EXCEPTION 'Unsupported JSON type: %', v_type;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION yen_validate_event_payload(p_type text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k_cnt int;
  uuid_regex text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  psn_regex text := '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  hex64_regex text := '^[0-9a-f]{64}$';
  max_safe numeric := 9007199254740991;
BEGIN
  IF jsonb_typeof(p_payload) != 'object' THEN
    RAISE EXCEPTION 'Payload must be a JSON object';
  END IF;

  SELECT count(*) INTO k_cnt FROM jsonb_object_keys(p_payload);

  CASE p_type
    WHEN 'fund.created' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'org_id') ~ uuid_regex) OR
         (p_payload->>'visibility') NOT IN ('private', 'members', 'public') THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'fund.policy_changed' THEN
      IF k_cnt != 2 OR
         jsonb_typeof(p_payload->'approval_quorum') != 'number' OR
         (p_payload->>'approval_quorum') !~ '^[0-9]+$' OR
         (p_payload->>'approval_quorum')::numeric < 1 OR
         (p_payload->>'approval_quorum')::numeric > max_safe OR
         jsonb_typeof(p_payload->'objection_window_hours') != 'number' OR
         (p_payload->>'objection_window_hours') !~ '^[0-9]+$' OR
         (p_payload->>'objection_window_hours')::numeric < 0 OR
         (p_payload->>'objection_window_hours')::numeric > max_safe THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'fund.visibility_changed' THEN
      IF k_cnt != 1 OR
         (p_payload->>'visibility') NOT IN ('private', 'members', 'public') THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'member.added' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'member_id') ~ psn_regex) OR
         (p_payload->>'role') NOT IN ('member', 'approver', 'treasurer') THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'member.removed' THEN
      IF k_cnt != 1 OR
         NOT ((p_payload->>'member_id') ~ psn_regex) THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'donation.pledged' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'donation_id') ~ uuid_regex) OR
         jsonb_typeof(p_payload->'amount_paise') != 'number' OR
         (p_payload->>'amount_paise') !~ '^[0-9]+$' OR
         (p_payload->>'amount_paise')::numeric < 1 OR
         (p_payload->>'amount_paise')::numeric > max_safe THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'donation.verified' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'donation_id') ~ uuid_regex) OR
         NOT ((p_payload->>'bank_transaction_id') ~ uuid_regex) THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'donation.rejected' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'donation_id') ~ uuid_regex) OR
         (p_payload->>'reason') NOT IN ('unmatched', 'duplicate', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'expense.submitted' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'expense_id') ~ uuid_regex) OR
         jsonb_typeof(p_payload->'amount_paise') != 'number' OR
         (p_payload->>'amount_paise') !~ '^[0-9]+$' OR
         (p_payload->>'amount_paise')::numeric < 1 OR
         (p_payload->>'amount_paise')::numeric > max_safe THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'expense.evidence_added' THEN
      IF k_cnt != 3 OR
         NOT ((p_payload->>'expense_id') ~ uuid_regex) OR
         NOT ((p_payload->>'evidence_id') ~ uuid_regex) OR
         NOT ((p_payload->>'content_sha256') ~ hex64_regex) THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'expense.flagged' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'expense_id') ~ uuid_regex) OR
         (p_payload->>'reason') NOT IN ('missing_evidence', 'policy', 'suspicious') THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'expense.objection_raised' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'expense_id') ~ uuid_regex) OR
         NOT ((p_payload->>'objection_id') ~ uuid_regex) THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'expense.objection_resolved' THEN
      IF k_cnt != 3 OR
         NOT ((p_payload->>'expense_id') ~ uuid_regex) OR
         NOT ((p_payload->>'objection_id') ~ uuid_regex) OR
         (p_payload->>'resolution') NOT IN ('upheld', 'dismissed') THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'expense.approved' THEN
      IF k_cnt != 1 OR
         NOT ((p_payload->>'expense_id') ~ uuid_regex) THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'expense.rejected' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'expense_id') ~ uuid_regex) OR
         (p_payload->>'reason') NOT IN ('quorum', 'objection', 'policy') THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'expense.expired' THEN
      IF k_cnt != 1 OR
         NOT ((p_payload->>'expense_id') ~ uuid_regex) THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'expense.paid' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'expense_id') ~ uuid_regex) OR
         NOT ((p_payload->>'bank_transaction_id') ~ uuid_regex) THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'expense.reversed' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'expense_id') ~ uuid_regex) OR
         NOT ((p_payload->>'bank_transaction_id') ~ uuid_regex) THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'bank.credit_seen' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'bank_transaction_id') ~ uuid_regex) OR
         jsonb_typeof(p_payload->'amount_paise') != 'number' OR
         (p_payload->>'amount_paise') !~ '^[0-9]+$' OR
         (p_payload->>'amount_paise')::numeric < 1 OR
         (p_payload->>'amount_paise')::numeric > max_safe THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'bank.debit_seen' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'bank_transaction_id') ~ uuid_regex) OR
         jsonb_typeof(p_payload->'amount_paise') != 'number' OR
         (p_payload->>'amount_paise') !~ '^[0-9]+$' OR
         (p_payload->>'amount_paise')::numeric < 1 OR
         (p_payload->>'amount_paise')::numeric > max_safe THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'bank.balance_checked' THEN
      IF k_cnt != 1 OR
         jsonb_typeof(p_payload->'balance_paise') != 'number' OR
         (p_payload->>'balance_paise') !~ '^-?[0-9]+$' OR
         (p_payload->>'balance_paise')::numeric < -max_safe OR
         (p_payload->>'balance_paise')::numeric > max_safe THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'discrepancy.raised' THEN
      IF k_cnt != 3 OR
         NOT ((p_payload->>'discrepancy_id') ~ uuid_regex) OR
         NOT ((p_payload->>'bank_transaction_id') ~ uuid_regex) OR
         (p_payload->>'kind') NOT IN ('unmatched_credit', 'unmatched_debit', 'balance_mismatch') THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'discrepancy.resolved' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'discrepancy_id') ~ uuid_regex) OR
         (p_payload->>'resolution') NOT IN ('matched', 'corrected', 'dismissed') THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    WHEN 'anchor.published' THEN
      IF k_cnt != 2 OR
         NOT ((p_payload->>'anchor_id') ~ uuid_regex) OR
         NOT ((p_payload->>'global_root') ~ hex64_regex) THEN
        RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
      END IF;

    ELSE
      RAISE EXCEPTION 'Unknown event type: %', p_type;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION yen_fund_events_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lock_key bigint;
  v_prev_seq bigint;
  v_prev_hash text;
  v_prev_occurred_at text;
  v_canonical_payload text;
  v_expected_envelope text;
  v_computed_hash text;
  v_domain bytea := convert_to('yen/eventlog/event/v1', 'UTF8') || E'\\x00'::bytea;
BEGIN
  -- (a) Acquire transaction-scoped per-fund advisory lock
  v_lock_key := yen_fund_lock_key(NEW.fund_id);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Validate event version
  IF NEW.version != 1 THEN
    RAISE EXCEPTION 'Unsupported event version: % (expected 1)', NEW.version;
  END IF;

  -- Validate actor pseudonym format
  IF NEW.actor !~ '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Invalid actor pseudonym format: %', NEW.actor;
  END IF;

  -- Validate occurred_at format
  IF NEW.occurred_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
    RAISE EXCEPTION 'Invalid occurred_at format: % (expected UTC YYYY-MM-DDTHH:mm:ss.sssZ)', NEW.occurred_at;
  END IF;

  -- Validate payload against known schema
  PERFORM yen_validate_event_payload(NEW.type, NEW.payload);

  -- (b) & (c) Sequence and prev_hash check
  SELECT seq, hash, occurred_at INTO v_prev_seq, v_prev_hash, v_prev_occurred_at
  FROM fund_events
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
  v_canonical_payload := yen_canonicalize_jsonb(NEW.payload);

  -- Check payload equality with payload inside canonical_envelope
  BEGIN
    IF (NEW.canonical_envelope::jsonb -> 'payload') IS DISTINCT FROM NEW.payload THEN
      RAISE EXCEPTION 'payload column does not match payload inside canonical_envelope';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'canonical_envelope is not valid JSON or payload mismatch: %', SQLERRM;
  END;

  -- (d) Reconstruct RFC 8785 canonical envelope of exactly the 8 fields
  v_expected_envelope := '{"actor":' || yen_canonical_json_string(NEW.actor) ||
                         ',"fund_id":' || yen_canonical_json_string(NEW.fund_id::text) ||
                         ',"occurred_at":' || yen_canonical_json_string(NEW.occurred_at) ||
                         ',"payload":' || v_canonical_payload ||
                         ',"prev_hash":' || yen_canonical_json_string(NEW.prev_hash) ||
                         ',"seq":' || NEW.seq::text ||
                         ',"type":' || yen_canonical_json_string(NEW.type) ||
                         ',"version":' || NEW.version::text || '}';

  IF NEW.canonical_envelope != v_expected_envelope THEN
    RAISE EXCEPTION 'canonical_envelope is not RFC 8785 canonical JSON of the unsigned envelope';
  END IF;

  -- Recompute SHA-256 over domain || canonical_envelope
  v_computed_hash := encode(sha256(v_domain || convert_to(NEW.canonical_envelope, 'UTF8')), 'hex');
  IF NEW.hash != v_computed_hash THEN
    RAISE EXCEPTION 'Event hash mismatch: supplied %, computed %', NEW.hash, v_computed_hash;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION yen_fund_events_no_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fund_events is append-only: UPDATE is forbidden';
END;
$$;

CREATE OR REPLACE FUNCTION yen_fund_events_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fund_events is append-only: DELETE is forbidden';
END;
$$;

CREATE OR REPLACE FUNCTION yen_fund_events_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fund_events is append-only: TRUNCATE is forbidden';
END;
$$;

CREATE TRIGGER fund_events_before_insert
BEFORE INSERT ON fund_events
FOR EACH ROW
EXECUTE FUNCTION yen_fund_events_before_insert();

CREATE TRIGGER fund_events_no_update
BEFORE UPDATE ON fund_events
FOR EACH ROW
EXECUTE FUNCTION yen_fund_events_no_update();

CREATE TRIGGER fund_events_no_delete
BEFORE DELETE ON fund_events
FOR EACH ROW
EXECUTE FUNCTION yen_fund_events_no_delete();

CREATE TRIGGER fund_events_no_truncate
BEFORE TRUNCATE ON fund_events
FOR EACH STATEMENT
EXECUTE FUNCTION yen_fund_events_no_truncate();

REVOKE UPDATE, DELETE, TRUNCATE ON fund_events FROM PUBLIC;
