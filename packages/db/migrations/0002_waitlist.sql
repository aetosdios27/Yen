CREATE TABLE waitlist_entries (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  contact_kind text NOT NULL CHECK (contact_kind IN ('email', 'phone')),
  contact text NOT NULL UNIQUE CHECK (char_length(contact) BETWEEN 3 AND 254),
  org text NOT NULL CHECK (char_length(org) BETWEEN 1 AND 200),
  locale text NOT NULL CHECK (locale IN ('en', 'hi')),
  consent_text text NOT NULL CHECK (char_length(consent_text) BETWEEN 1 AND 1000),
  consent_version text NOT NULL CHECK (char_length(consent_version) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((contact_kind = 'phone' AND contact ~ '^\+[1-9][0-9]{7,14}$') OR
    (contact_kind = 'email' AND contact = lower(contact) AND char_length(contact) - char_length(replace(contact, '@', '')) = 1))
);
