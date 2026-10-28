-- Expected application role: yen_app (or whichever non-superuser role the API runs as).
-- Direct UPDATE, DELETE, and TRUNCATE are revoked from PUBLIC and rejected by triggers.
-- The application role must not hold TEMP on the database (see packages/db/README.md): every
-- function and trigger body here schema-qualifies its table and helper references and pins
-- search_path with pg_temp last, so a temporary object cannot shadow the real chain head.
-- RFC 8785 canonicalization and domain-separated SHA-256 verification are database-enforced.
--
-- Primary documentation references:
-- - RFC 8785 JSON Canonicalization Scheme (JCS): https://www.rfc-editor.org/rfc/rfc8785
--   (Section 3.2.3 UTF-16 code unit key ordering; Section 3.2.2.2 string escaping; Section 3.2.2.3 numbers)
-- - PostgreSQL 16 Advisory Locks: https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS
--   (pg_advisory_xact_lock(bigint) holds exclusive lock until transaction commit/rollback)
-- - PostgreSQL 16 Binary String Functions: https://www.postgresql.org/docs/16/functions-binarystring.html
--   (Built-in sha256(bytea) -> bytea)
-- - PostgreSQL 16 Secure Function Search Path: https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY

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
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT (('x' || pg_catalog.substr(pg_catalog.replace(p_fund_id::text, '-', ''), 1, 16))::bit(64) #
          ('x' || pg_catalog.substr(pg_catalog.replace(p_fund_id::text, '-', ''), 17, 16))::bit(64))::bigint;
$$;

CREATE OR REPLACE FUNCTION yen_utf16_sort_key(s text)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
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
  len := pg_catalog.length(s);
  FOR i IN 1..len LOOP
    cp := pg_catalog.ascii(pg_catalog.substr(s, i, 1));
    IF cp <= 65535 THEN
      res := res || pg_catalog.set_byte(pg_catalog.set_byte(E'\\000\\000'::bytea, 0, cp >> 8), 1, cp & 255);
    ELSE
      hi := 55296 + ((cp - 65536) >> 10);
      lo := 56320 + ((cp - 65536) & 1023);
      res := res || pg_catalog.set_byte(pg_catalog.set_byte(pg_catalog.set_byte(pg_catalog.set_byte(E'\\000\\000\\000\\000'::bytea, 0, hi >> 8), 1, hi & 255), 2, lo >> 8), 3, lo & 255);
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
SET search_path = pg_catalog, public, pg_temp
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
  len := pg_catalog.length(s);
  FOR i IN 1..len LOOP
    ch := pg_catalog.substr(s, i, 1);
    cp := pg_catalog.ascii(ch);
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
      res := res || '\u00' || pg_catalog.lpad(pg_catalog.to_hex(cp), 2, '0');
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
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  s text;
  sign text := '';
  mag numeric := pg_catalog.abs(val);
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
    s := pg_catalog.rtrim(pg_catalog.rtrim(pg_catalog.to_char(mag, 'FM999999999999999999990.09999999999999999999'), '0'), '.');
    RETURN sign || s;
  END IF;
  exp_val := pg_catalog.floor(pg_catalog.log(mag));
  mantissa := mag / (10::numeric ^ exp_val);
  IF mantissa >= 10 THEN
    mantissa := mantissa / 10;
    exp_val := exp_val + 1;
  ELSIF mantissa < 1 THEN
    mantissa := mantissa * 10;
    exp_val := exp_val - 1;
  END IF;
  s := pg_catalog.rtrim(pg_catalog.rtrim(pg_catalog.to_char(mantissa, 'FM990.09999999999999999999'), '0'), '.');
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
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_type text := pg_catalog.jsonb_typeof(val);
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
    RETURN public.yen_canonical_json_string(val #>> '{}');
  ELSIF v_type = 'number' THEN
    RETURN public.yen_es_number((val #>> '{}')::numeric);
  ELSIF v_type = 'array' THEN
    res := '[';
    FOR elem IN SELECT value FROM pg_catalog.jsonb_array_elements(val) LOOP
      IF NOT first_item THEN
        res := res || ',';
      ELSE
        first_item := false;
      END IF;
      res := res || public.yen_canonicalize_jsonb(elem);
    END LOOP;
    RETURN res || ']';
  ELSIF v_type = 'object' THEN
    res := '{';
    FOR k, v IN
      SELECT key, value
      FROM pg_catalog.jsonb_each(val)
      ORDER BY public.yen_utf16_sort_key(key)
    LOOP
      IF NOT first_item THEN
        res := res || ',';
      ELSE
        first_item := false;
      END IF;
      res := res || public.yen_canonical_json_string(k) || ':' || public.yen_canonicalize_jsonb(v);
    END LOOP;
    RETURN res || '}';
  ELSE
    RAISE EXCEPTION 'Unsupported JSON type: %', v_type;
  END IF;
END;
$$;

-- Every predicate below is a conjunction of total (never-NULL) boolean helpers, so a
-- missing key, a JSON null, or a wrong JSON type makes the predicate FALSE rather than NULL.
-- The caller rejects unless the whole predicate IS TRUE. Nothing here uses NOT or OR over a
-- value that can be NULL, so NULL cannot flip a rejection into an acceptance.

CREATE OR REPLACE FUNCTION yen_has_exact_keys(p jsonb, keys text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p) = 'object'
      THEN p ?& keys AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p)) = pg_catalog.cardinality(keys)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION yen_json_string_matches(v jsonb, pattern text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(v) = 'string' THEN (v #>> '{}') ~ pattern
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION yen_json_string_in(v jsonb, allowed text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(v) = 'string' THEN (v #>> '{}') = ANY (allowed)
    ELSE false
  END;
$$;

-- Match JavaScript integer values, including numerically integral JSON decimals.
CREATE OR REPLACE FUNCTION yen_json_integer_between(v jsonb, lo numeric, hi numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(v) = 'number'
      THEN (v #>> '{}')::numeric = pg_catalog.trunc((v #>> '{}')::numeric)
        AND (v #>> '{}')::numeric BETWEEN lo AND hi
    ELSE false
  END;
$$;

-- Accepts exactly the strings that the TypeScript schema in @yen/eventlog accepts for
-- occurred_at: a real UTC instant with millisecond precision, YYYY-MM-DDTHH:mm:ss.sssZ.
-- Calendar and clock fields are checked arithmetically (proleptic Gregorian, year 0000 valid),
-- because PostgreSQL timestamptz has no year 0000 and would reject a value that
-- Date.parse + toISOString round-trips.
CREATE OR REPLACE FUNCTION yen_is_utc_millisecond_instant(s text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  y integer;
  mo integer;
  d integer;
  h integer;
  mi integer;
  sec integer;
  days integer;
BEGIN
  IF s IS NULL OR s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
    RETURN false;
  END IF;
  y := pg_catalog.substr(s, 1, 4)::integer;
  mo := pg_catalog.substr(s, 6, 2)::integer;
  d := pg_catalog.substr(s, 9, 2)::integer;
  h := pg_catalog.substr(s, 12, 2)::integer;
  mi := pg_catalog.substr(s, 15, 2)::integer;
  sec := pg_catalog.substr(s, 18, 2)::integer;
  IF mo < 1 OR mo > 12 THEN
    RETURN false;
  END IF;
  days := CASE
    WHEN mo = 2 AND ((y % 4 = 0 AND y % 100 <> 0) OR y % 400 = 0) THEN 29
    WHEN mo = 2 THEN 28
    WHEN mo IN (4, 6, 9, 11) THEN 30
    ELSE 31
  END;
  RETURN d >= 1 AND d <= days AND h <= 23 AND mi <= 59 AND sec <= 59;
END;
$$;

-- Payload schemas mirror payloadSchemas in packages/eventlog/src/model.ts (z.strictObject:
-- exact key set; enums; uuid, psn and 64-hex patterns; integers within MAX_SAFE_INTEGER).
CREATE OR REPLACE FUNCTION yen_validate_event_payload(p_type text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  uuid_regex text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  psn_regex text := '^psn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  hex64_regex text := '^[0-9a-f]{64}$';
  max_safe numeric := 9007199254740991;
  v_valid boolean;
BEGIN
  IF pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Payload must be a JSON object';
  END IF;

  CASE p_type
    WHEN 'fund.created' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['org_id', 'visibility'])
        AND public.yen_json_string_matches(p_payload->'org_id', uuid_regex)
        AND public.yen_json_string_in(p_payload->'visibility', ARRAY['private', 'members', 'public']);

    WHEN 'fund.policy_changed' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['approval_quorum', 'objection_window_hours'])
        AND public.yen_json_integer_between(p_payload->'approval_quorum', 1, max_safe)
        AND public.yen_json_integer_between(p_payload->'objection_window_hours', 0, max_safe);

    WHEN 'fund.visibility_changed' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['visibility'])
        AND public.yen_json_string_in(p_payload->'visibility', ARRAY['private', 'members', 'public']);

    WHEN 'member.added' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['member_id', 'role'])
        AND public.yen_json_string_matches(p_payload->'member_id', psn_regex)
        AND public.yen_json_string_in(p_payload->'role', ARRAY['member', 'approver', 'treasurer']);

    WHEN 'member.removed' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['member_id'])
        AND public.yen_json_string_matches(p_payload->'member_id', psn_regex);

    WHEN 'donation.pledged' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['donation_id', 'amount_paise'])
        AND public.yen_json_string_matches(p_payload->'donation_id', uuid_regex)
        AND public.yen_json_integer_between(p_payload->'amount_paise', 1, max_safe);

    WHEN 'donation.verified' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['donation_id', 'bank_transaction_id'])
        AND public.yen_json_string_matches(p_payload->'donation_id', uuid_regex)
        AND public.yen_json_string_matches(p_payload->'bank_transaction_id', uuid_regex);

    WHEN 'donation.rejected' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['donation_id', 'reason'])
        AND public.yen_json_string_matches(p_payload->'donation_id', uuid_regex)
        AND public.yen_json_string_in(p_payload->'reason', ARRAY['unmatched', 'duplicate', 'cancelled']);

    WHEN 'expense.submitted' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['expense_id', 'amount_paise'])
        AND public.yen_json_string_matches(p_payload->'expense_id', uuid_regex)
        AND public.yen_json_integer_between(p_payload->'amount_paise', 1, max_safe);

    WHEN 'expense.evidence_added' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['expense_id', 'evidence_id', 'content_sha256'])
        AND public.yen_json_string_matches(p_payload->'expense_id', uuid_regex)
        AND public.yen_json_string_matches(p_payload->'evidence_id', uuid_regex)
        AND public.yen_json_string_matches(p_payload->'content_sha256', hex64_regex);

    WHEN 'expense.flagged' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['expense_id', 'reason'])
        AND public.yen_json_string_matches(p_payload->'expense_id', uuid_regex)
        AND public.yen_json_string_in(p_payload->'reason', ARRAY['missing_evidence', 'policy', 'suspicious']);

    WHEN 'expense.objection_raised' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['expense_id', 'objection_id'])
        AND public.yen_json_string_matches(p_payload->'expense_id', uuid_regex)
        AND public.yen_json_string_matches(p_payload->'objection_id', uuid_regex);

    WHEN 'expense.objection_resolved' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['expense_id', 'objection_id', 'resolution'])
        AND public.yen_json_string_matches(p_payload->'expense_id', uuid_regex)
        AND public.yen_json_string_matches(p_payload->'objection_id', uuid_regex)
        AND public.yen_json_string_in(p_payload->'resolution', ARRAY['upheld', 'dismissed']);

    WHEN 'expense.approved' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['expense_id'])
        AND public.yen_json_string_matches(p_payload->'expense_id', uuid_regex);

    WHEN 'expense.rejected' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['expense_id', 'reason'])
        AND public.yen_json_string_matches(p_payload->'expense_id', uuid_regex)
        AND public.yen_json_string_in(p_payload->'reason', ARRAY['quorum', 'objection', 'policy']);

    WHEN 'expense.expired' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['expense_id'])
        AND public.yen_json_string_matches(p_payload->'expense_id', uuid_regex);

    WHEN 'expense.paid' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['expense_id', 'bank_transaction_id'])
        AND public.yen_json_string_matches(p_payload->'expense_id', uuid_regex)
        AND public.yen_json_string_matches(p_payload->'bank_transaction_id', uuid_regex);

    WHEN 'expense.reversed' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['expense_id', 'bank_transaction_id'])
        AND public.yen_json_string_matches(p_payload->'expense_id', uuid_regex)
        AND public.yen_json_string_matches(p_payload->'bank_transaction_id', uuid_regex);

    WHEN 'bank.credit_seen' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['bank_transaction_id', 'amount_paise'])
        AND public.yen_json_string_matches(p_payload->'bank_transaction_id', uuid_regex)
        AND public.yen_json_integer_between(p_payload->'amount_paise', 1, max_safe);

    WHEN 'bank.debit_seen' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['bank_transaction_id', 'amount_paise'])
        AND public.yen_json_string_matches(p_payload->'bank_transaction_id', uuid_regex)
        AND public.yen_json_integer_between(p_payload->'amount_paise', 1, max_safe);

    WHEN 'bank.balance_checked' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['balance_paise'])
        AND public.yen_json_integer_between(p_payload->'balance_paise', -max_safe, max_safe);

    WHEN 'discrepancy.raised' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['discrepancy_id', 'bank_transaction_id', 'kind'])
        AND public.yen_json_string_matches(p_payload->'discrepancy_id', uuid_regex)
        AND public.yen_json_string_matches(p_payload->'bank_transaction_id', uuid_regex)
        AND public.yen_json_string_in(p_payload->'kind', ARRAY['unmatched_credit', 'unmatched_debit', 'balance_mismatch']);

    WHEN 'discrepancy.resolved' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['discrepancy_id', 'resolution'])
        AND public.yen_json_string_matches(p_payload->'discrepancy_id', uuid_regex)
        AND public.yen_json_string_in(p_payload->'resolution', ARRAY['matched', 'corrected', 'dismissed']);

    WHEN 'anchor.published' THEN
      v_valid := public.yen_has_exact_keys(p_payload, ARRAY['anchor_id', 'global_root'])
        AND public.yen_json_string_matches(p_payload->'anchor_id', uuid_regex)
        AND public.yen_json_string_matches(p_payload->'global_root', hex64_regex);

    ELSE
      RAISE EXCEPTION 'Unknown event type: %', p_type;
  END CASE;

  IF v_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'Invalid payload for %: %', p_type, p_payload;
  END IF;
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
  IF NEW.version != 1 THEN
    RAISE EXCEPTION 'Unsupported event version: % (expected 1)', NEW.version;
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

CREATE OR REPLACE FUNCTION yen_fund_events_no_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'fund_events is append-only: UPDATE is forbidden';
END;
$$;

CREATE OR REPLACE FUNCTION yen_fund_events_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'fund_events is append-only: DELETE is forbidden';
END;
$$;

CREATE OR REPLACE FUNCTION yen_fund_events_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
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
