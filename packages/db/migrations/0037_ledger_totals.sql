CREATE FUNCTION yen_init_konto_totals() RETURNS void AS $install$
BEGIN
  IF to_regclass('konto_accounts') IS NULL OR to_regclass('konto_account_totals') IS NOT NULL THEN
    RETURN;
  END IF;
  LOCK TABLE konto_entries, konto_holds IN SHARE ROW EXCLUSIVE MODE;
  IF to_regclass('konto_account_totals') IS NOT NULL THEN
    RETURN;
  END IF;
  CREATE INDEX IF NOT EXISTS idx_entries_journal ON konto_entries(journal_id);
CREATE TABLE konto_account_totals (
  account_id UUID PRIMARY KEY REFERENCES konto_accounts(id) ON DELETE RESTRICT,
  entries_total NUMERIC NOT NULL DEFAULT 0,
  pending_nonexpiring NUMERIC NOT NULL DEFAULT 0
);

INSERT INTO konto_account_totals (account_id, entries_total, pending_nonexpiring)
SELECT a.id,
  COALESCE((SELECT SUM(e.amount) FROM konto_entries e WHERE e.account_id = a.id), 0),
  COALESCE((SELECT SUM(h.amount) FROM konto_holds h WHERE h.account_id = a.id
    AND h.status = 'PENDING' AND h.expires_at IS NULL), 0)
FROM konto_accounts a;

CREATE FUNCTION yen_konto_entry_total() RETURNS trigger AS $$
BEGIN
  INSERT INTO konto_account_totals (account_id, entries_total)
  SELECT account_id, SUM(amount) FROM new_entries GROUP BY account_id ORDER BY account_id
  ON CONFLICT (account_id) DO UPDATE
    SET entries_total = konto_account_totals.entries_total + EXCLUDED.entries_total;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maintain_entry_total AFTER INSERT ON konto_entries
  REFERENCING NEW TABLE AS new_entries FOR EACH STATEMENT EXECUTE FUNCTION yen_konto_entry_total();

CREATE FUNCTION yen_konto_hold_insert_total() RETURNS trigger AS $$
BEGIN
  INSERT INTO konto_account_totals (account_id, pending_nonexpiring)
  SELECT account_id, SUM(amount) FROM new_holds
  WHERE status = 'PENDING' AND expires_at IS NULL
  GROUP BY account_id ORDER BY account_id
  ON CONFLICT (account_id) DO UPDATE
    SET pending_nonexpiring = konto_account_totals.pending_nonexpiring + EXCLUDED.pending_nonexpiring;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maintain_hold_insert_total AFTER INSERT ON konto_holds
  REFERENCING NEW TABLE AS new_holds FOR EACH STATEMENT
  EXECUTE FUNCTION yen_konto_hold_insert_total();

CREATE FUNCTION yen_konto_hold_total() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status = 'PENDING' AND OLD.expires_at IS NULL THEN
    INSERT INTO konto_account_totals (account_id, pending_nonexpiring)
    VALUES (OLD.account_id, -OLD.amount)
    ON CONFLICT (account_id) DO UPDATE
      SET pending_nonexpiring = konto_account_totals.pending_nonexpiring + EXCLUDED.pending_nonexpiring;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.status = 'PENDING' AND NEW.expires_at IS NULL THEN
    INSERT INTO konto_account_totals (account_id, pending_nonexpiring)
    VALUES (NEW.account_id, NEW.amount)
    ON CONFLICT (account_id) DO UPDATE
      SET pending_nonexpiring = konto_account_totals.pending_nonexpiring + EXCLUDED.pending_nonexpiring;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maintain_hold_total AFTER UPDATE OR DELETE ON konto_holds
  FOR EACH ROW EXECUTE FUNCTION yen_konto_hold_total();

CREATE FUNCTION yen_konto_holds_truncate_total() RETURNS trigger AS $$
BEGIN
  UPDATE konto_account_totals SET pending_nonexpiring = 0 WHERE pending_nonexpiring <> 0;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maintain_holds_truncate_total AFTER TRUNCATE ON konto_holds
  FOR EACH STATEMENT EXECUTE FUNCTION yen_konto_holds_truncate_total();

CREATE INDEX idx_holds_expiring ON konto_holds(account_id, expires_at) INCLUDE (amount)
  WHERE status = 'PENDING' AND expires_at IS NOT NULL;

-- Expiring holds remain time-dependent; keep their range query separate from the
-- incrementally maintained totals so an expired hold needs no background writer.
CREATE FUNCTION yen_konto_available(p_account UUID, p_exclude UUID DEFAULT NULL)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT entries_total - pending_nonexpiring
    FROM konto_account_totals WHERE account_id = p_account), 0)
    - COALESCE((SELECT SUM(amount) FROM konto_holds
      WHERE account_id = p_account AND status = 'PENDING'
        AND expires_at IS NOT NULL AND expires_at >= NOW()), 0)
    + COALESCE((SELECT amount FROM konto_holds WHERE id = p_exclude
      AND account_id = p_account AND status = 'PENDING'
      AND (expires_at IS NULL OR expires_at >= NOW())), 0)
$$;

END;
$install$ LANGUAGE plpgsql;

SELECT yen_init_konto_totals();
