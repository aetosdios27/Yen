CREATE TABLE users (
  id uuid PRIMARY KEY,
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  display_name text NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orgs (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  legal_form text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX orgs_owner_id_idx ON orgs(owner_id);

CREATE TABLE funds (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id),
  title text NOT NULL,
  target_paise bigint CHECK (target_paise >= 0),
  visibility_tier text NOT NULL DEFAULT 'donors'
    CHECK (visibility_tier IN ('public', 'donors', 'members', 'private')),
  policy_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'closed')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX funds_org_id_idx ON funds(org_id);

CREATE TABLE memberships (
  fund_id uuid NOT NULL REFERENCES funds(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner', 'treasurer', 'approver', 'auditor', 'member')),
  status text NOT NULL CHECK (status IN ('invited', 'active', 'removed')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fund_id, user_id, role)
);
CREATE INDEX memberships_user_id_idx ON memberships(user_id);

CREATE TABLE pseudonyms (
  pseudonym_id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id)
);

CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys(created_at);
