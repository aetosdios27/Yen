CREATE TABLE evidence_records (
  evidence_id uuid PRIMARY KEY,
  expense_id uuid NOT NULL REFERENCES expenses(id),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size_bytes integer NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 10485760),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 120),
  storage_key text NOT NULL UNIQUE,
  scan_result text NOT NULL CHECK (scan_result = 'clean'),
  scanner_name text NOT NULL CHECK (char_length(scanner_name) BETWEEN 1 AND 120),
  signature_version text NOT NULL CHECK (char_length(signature_version) BETWEEN 1 AND 256),
  vendor_name text,
  gstin text,
  invoice_number text,
  invoice_date text,
  created_at timestamptz NOT NULL
);

CREATE INDEX evidence_records_expense_id_created_at_idx
  ON evidence_records (expense_id, created_at, evidence_id);
CREATE INDEX evidence_records_file_sha256_idx ON evidence_records (file_sha256, expense_id);

CREATE FUNCTION yen_evidence_records_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'evidence_records is append-only: % is forbidden', TG_OP;
END;
$$;

CREATE TRIGGER evidence_records_no_update_or_delete
BEFORE UPDATE OR DELETE ON evidence_records
FOR EACH ROW EXECUTE FUNCTION yen_evidence_records_no_mutation();
CREATE TRIGGER evidence_records_no_truncate
BEFORE TRUNCATE ON evidence_records
FOR EACH STATEMENT EXECUTE FUNCTION yen_evidence_records_no_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON evidence_records FROM PUBLIC;
