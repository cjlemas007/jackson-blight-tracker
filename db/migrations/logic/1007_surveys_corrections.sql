-- LOGIC LAYER: survey sessions and public correction requests (build step 6).

-- Survey sessions ---------------------------------------------------------------------------
-- A staff member picks a street or an area and marks every parcel. Each mark is a row in
-- app.parcel_surveys (append-only; the latest mark for a parcel wins).
CREATE TABLE app.surveys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind    text NOT NULL CHECK (scope_kind IN ('street', 'ward', 'neighborhood', 'tract')),
  scope_value   text NOT NULL,
  scope_label   text NOT NULL,
  created_by    uuid NOT NULL REFERENCES app.staff (id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX ON app.surveys (created_by, started_at DESC);

ALTER TABLE app.parcel_surveys ADD COLUMN survey_id uuid REFERENCES app.surveys (id);
CREATE INDEX ON app.parcel_surveys (survey_id);

-- Correction requests -----------------------------------------------------------------------
-- Anyone can ask for a correction from a parcel or owner page. Contact details are optional and
-- visible only to admins.
CREATE TABLE app.corrections (
  id             bigserial PRIMARY KEY,
  county         text,
  parcel_id      text,
  portfolio_id   text,
  category       text NOT NULL CHECK (category IN (
                   'not_blighted', 'fixed_or_demolished', 'wrong_owner', 'wrong_parcel', 'privacy', 'wrong_status', 'other')),
  details        text NOT NULL CHECK (char_length(details) BETWEEN 10 AND 2000),
  contact_name   text CHECK (char_length(contact_name) <= 120),
  contact_email  text CHECK (char_length(contact_email) <= 200),
  submitter_hash text NOT NULL,                -- salted hash of IP + user agent, for rate limiting only
  page_url       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'corrected', 'declined')),
  resolved_by    uuid REFERENCES app.staff (id),
  resolved_at    timestamptz,
  resolution     text,                         -- what was done (internal)
  CHECK (parcel_id IS NOT NULL OR portfolio_id IS NOT NULL)
);
CREATE INDEX ON app.corrections (status, created_at DESC);
CREATE INDEX ON app.corrections (submitter_hash, created_at DESC);
