-- Mirror normalizePhone: only explicit international or recognized Indian mobile forms.
CREATE FUNCTION normalize_subscription_phone(raw text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  WITH trimmed AS (
    SELECT regexp_replace(raw, U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+|[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+$', '', 'g') AS value
  ), compact AS (
    SELECT value AS trimmed, regexp_replace(value, U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF-]', '', 'g') AS value FROM trimmed
  )
  SELECT CASE
    WHEN trimmed LIKE '+%' AND value ~ '^\+[1-9][0-9]{7,14}$' THEN value
    WHEN value ~ '^[6-9][0-9]{9}$' THEN '+91' || value
    WHEN value ~ '^0[6-9][0-9]{9}$' THEN '+91' || substring(value from 2)
    WHEN value ~ '^91[6-9][0-9]{9}$' THEN '+' || value
    ELSE NULL
  END FROM compact
$$;

-- Unknown destinations cannot receive messages or satisfy the canonical-phone constraint.
ALTER TABLE fund_subscriptions ALTER COLUMN contact DROP NOT NULL;
UPDATE fund_subscriptions SET status = 'unsubscribed', unsubscribed_at = CURRENT_TIMESTAMP, contact = NULL
WHERE contact_type = 'phone' AND normalize_subscription_phone(contact) IS NULL;

-- Prefer an unsubscribed row to avoid resurrecting a withdrawn subscription; then oldest/id.
DELETE FROM fund_subscriptions WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY fund_id, normalize_subscription_phone(contact)
      ORDER BY (status = 'unsubscribed') DESC, created_at, id
    ) AS position
    FROM fund_subscriptions WHERE contact_type = 'phone' AND contact IS NOT NULL
  ) ranked WHERE position > 1
);
UPDATE fund_subscriptions SET contact = normalize_subscription_phone(contact)
WHERE contact_type = 'phone';
ALTER TABLE fund_subscriptions ADD CONSTRAINT subscription_phone_canonical
CHECK ((contact IS NULL AND status = 'unsubscribed' AND contact_type = 'phone')
  OR (contact IS NOT NULL AND (contact_type <> 'phone' OR contact ~ '^\+[1-9][0-9]{7,14}$')));
