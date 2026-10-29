-- Names are mutable PII and must remain outside fund_events. Pseudonyms are
-- historical identifiers, so this table deliberately does not reference their
-- erasable mapping row.
ALTER TABLE funds
  ADD COLUMN show_officeholder_names boolean NOT NULL DEFAULT false;

ALTER TABLE donation_pledges
  ADD COLUMN donor_name_choice text NOT NULL DEFAULT 'initials'
    CHECK (donor_name_choice IN ('full', 'initials', 'anonymous'));

CREATE TABLE display_names (
  fund_id uuid NOT NULL REFERENCES funds(id),
  pseudonym_id uuid NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fund_id, pseudonym_id)
);

-- Guest contacts are hashed with a fund-specific random salt. Keeping the salt
-- separately lets the name table contain no raw phone number or email address.
CREATE TABLE display_name_contact_salts (
  fund_id uuid PRIMARY KEY REFERENCES funds(id),
  salt bytea NOT NULL CHECK (octet_length(salt) = 32)
);

CREATE TABLE guest_display_names (
  fund_id uuid NOT NULL REFERENCES funds(id),
  contact_hash bytea NOT NULL CHECK (octet_length(contact_hash) = 32),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fund_id, contact_hash)
);
