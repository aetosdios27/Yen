CREATE TABLE yen_ids (
  yen_id text PRIMARY KEY CHECK (yen_id ~ '^[1-9][0-9]{8}$'),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
