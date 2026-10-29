ALTER TABLE funds
  ADD COLUMN purpose text,
  ADD COLUMN upi_vpa text,
  ADD COLUMN upi_payee_name text,
  ADD COLUMN fund_settings_json jsonb NOT NULL DEFAULT '{}'::jsonb;
