ALTER TABLE funds
  ADD COLUMN payee_vpa text NOT NULL DEFAULT '',
  ADD COLUMN payee_name text NOT NULL DEFAULT '',
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

-- Add the payee event without changing any existing event schema or hash rule.
ALTER FUNCTION yen_validate_event_payload(text, jsonb) RENAME TO yen_validate_event_payload_before_payee;
CREATE OR REPLACE FUNCTION yen_validate_event_payload(p_type text, p_payload jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_type = 'fund.payee_changed' THEN
    IF NOT public.yen_has_exact_keys(p_payload, ARRAY[]::text[]) THEN
      RAISE EXCEPTION 'Invalid fund.payee_changed payload: %', p_payload;
    END IF;
    RETURN;
  END IF;
  PERFORM public.yen_validate_event_payload_before_payee(p_type, p_payload);
END;
$$;
