-- LOGIC LAYER: owner portfolios, owned and edited by this site's newsroom admins.
-- (Not synced from any Sheet.) Rankings group by portfolio_id, never by raw owner names.
--
-- A parcel's portfolio is resolved in app.parcel_owner (1003_parcels.sql):
--   1. portfolio_owner_overrides  exact owner name             -> 'override'
--   2. portfolio_mailing_keys     normalized mailing key        -> 'mailing_key'
--   3. portfolio_mailing_keys     street line only, when the land roll lost the
--                                 city/state to its column shift -> 'mailing_street'
--   4. derived                    'MK:' || normalized mailing key, or 'OWN:' || owner
--                                 name when there's no mailing address (parcel-map-only)
-- Keys must be stored normalized (src/lib/normalize/address.ts normalizeMailingKey).

CREATE TABLE app.portfolios (
  portfolio_id  text PRIMARY KEY CHECK (portfolio_id ~ '^[A-Z0-9_]+$'),
  display_name  text NOT NULL,
  principal     text,
  notes         text,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.portfolio_mailing_keys (
  mailing_key    text PRIMARY KEY,           -- normalized "STREET|CITY|STATE"
  portfolio_id   text NOT NULL REFERENCES app.portfolios (portfolio_id),
  sos_entity     text,                       -- Secretary of State entity found at this address
  entity_status  text,                       -- from the SOS lookup (Active, Dissolved, ...)
  registered_agent text,
  evidence       text,                       -- why this address belongs to the portfolio
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.portfolio_mailing_keys (portfolio_id);
CREATE INDEX ON app.portfolio_mailing_keys ((split_part(mailing_key, '|', 1)));

CREATE TABLE app.portfolio_owner_overrides (
  owner_name    text PRIMARY KEY CHECK (owner_name = upper(btrim(owner_name))),
  portfolio_id  text NOT NULL REFERENCES app.portfolios (portfolio_id),
  evidence      text,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Seed: the Mattiace Development portfolio, copied 2026-11-13 from the WLBT owner_groups
-- Sheet (the spec's grouping check). Nothing else from that Sheet is carried over.
INSERT INTO app.portfolios (portfolio_id, display_name, principal, notes, created_by) VALUES
  ('MATTIACE_DEV', 'T. Andrew Mattiace / Mattiace Development', 'T. Andrew Mattiace',
   'Seeded from the owner_groups Sheet on 2026-11-13.', 'seed');

INSERT INTO app.portfolio_mailing_keys (mailing_key, portfolio_id, sos_entity, entity_status, registered_agent, evidence, created_by) VALUES
  ('125 S CONGRESS ST STE 1800|JACKSON|MS', 'MATTIACE_DEV',
   'MATTIACE DEVELOPMENT COMPANY LLC; LAMAR LIFE QALICB LLC; FONDREN PLACE DEVELOPMENT COMPANY LLC', 'Active', 'Mark T Davis',
   'SOS: T. Andrew Mattiace principal of the entities at this address', 'seed'),
  ('P O BOX 13809|JACKSON|MS', 'MATTIACE_DEV', 'HIGHLAND BLUFF NORTH LLC', 'Active', 'Andrew Mattiace',
   'SOS: T. Andrew Mattiace principal', 'seed'),
  ('1000 HIGHLAND COLONY PKWY||MS', 'MATTIACE_DEV', 'RENAISSANCE AT COLONY PARK LLC', 'Active', 'H C Bailey',
   'H.C. Bailey listed as SOS manager, but Mattiace signed the 2026 annual report as Manager', 'seed');
