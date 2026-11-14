-- DATA LAYER: synced source data, untouched by app logic except through the sync.
-- Keys always include county (v1 is Hinds only).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS data;

-- Sync bookkeeping -----------------------------------------------------------------------

-- One row per job: where it is, so an interrupted run resumes instead of restarting.
CREATE TABLE data.sync_state (
  job          text PRIMARY KEY,
  run_id       uuid NOT NULL,
  status       text NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  cursor       jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows_done    integer NOT NULL DEFAULT 0,
  started_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  error        text
);

CREATE TABLE data.sync_runs (
  id           bigserial PRIMARY KEY,
  job          text NOT NULL,
  run_id       uuid NOT NULL,
  status       text NOT NULL,
  rows_done    integer NOT NULL DEFAULT 0,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz NOT NULL DEFAULT now(),
  error        text,
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ON data.sync_runs (job, finished_at DESC);

-- Land roll (BigQuery property_tax.properties, deduped) ------------------------------------

CREATE TABLE data.landroll_parcels (
  county             text NOT NULL,
  parcel_id          text NOT NULL,
  owner_name         text,
  owner_type         text NOT NULL CHECK (owner_type IN ('state_forfeited', 'city', 'public', 'private')),
  owner_estate_heirs boolean NOT NULL DEFAULT false,
  mailing_care_of    text,
  mailing_street     text,
  mailing_city       text,
  mailing_state      text,
  mailing_zip        text,
  mailing_repaired   boolean NOT NULL DEFAULT false,
  mailing_key        text,          -- normalized "STREET|CITY|STATE"
  mailing_street_key text,          -- normalized street line only
  situs_address      text,
  situs_number       integer,
  situs_street       text,          -- normalized street name from the land roll
  appraised_total    numeric,
  assessed_total     numeric,
  acreage            numeric,
  legal_description  text,
  deed_date          date,
  year_built         integer,
  source_loaded_at   timestamptz,   -- when the land roll file was loaded upstream ("as of")
  row_hash           text NOT NULL,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  retired_at         timestamptz,   -- dropped from the roll (split/merged/retired parcel)
  PRIMARY KEY (county, parcel_id)
);
CREATE INDEX ON data.landroll_parcels (county, mailing_key);
CREATE INDEX ON data.landroll_parcels (county, mailing_street_key);
CREATE INDEX ON data.landroll_parcels (county, situs_street, situs_number);
CREATE INDEX ON data.landroll_parcels (owner_type);
-- Immediate parent id ("4854-104-6" -> "4854-104"): used to keep a parcel-map parent from
-- being counted alongside its land roll children.
CREATE INDEX ON data.landroll_parcels (county, (regexp_replace(parcel_id, '-[^-]+$', '')));

-- Tax status summary (BigQuery property_tax.tax_history, deduped) --------------------------

CREATE TABLE data.parcel_tax (
  county             text NOT NULL,
  parcel_id          text NOT NULL,
  latest_tax_year    integer,
  -- Stand-in for tCurDue: unpaid latest-year bills. amount_still_owed when captured, else
  -- balance_due, else billed - paid (the scraper missed amount_still_owed on ~11k bills).
  current_due        numeric NOT NULL DEFAULT 0,
  current_due_estimated boolean NOT NULL DEFAULT false,  -- true when the fallback (no interest) was used
  current_billed     numeric,
  unpaid_years       integer[] NOT NULL DEFAULT '{}',  -- years with blank status (not Paid/Redeemed)
  redeemed_years     integer[] NOT NULL DEFAULT '{}',
  -- latest load has both a Paid row and an owed row for the latest year (~1.7k parcels);
  -- current_due still reports the owed amount, but the figure is flagged as uncertain.
  tax_conflict       boolean NOT NULL DEFAULT false,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (county, parcel_id)
);

-- Parcel geometry and assessor attributes (City of Jackson AGOL parcel layer) ---------------

CREATE TABLE data.gis_parcels (
  county         text NOT NULL,
  parcel_id      text NOT NULL,      -- PARCEL_F, same form as the land roll
  dpin           text,
  geom           geometry(MultiPolygon, 4326) NOT NULL,
  geom_3857      geometry(MultiPolygon, 3857) NOT NULL,
  pt             geometry(Point, 4326) NOT NULL,   -- ST_PointOnSurface: always inside the parcel
  owner_name_gis text,
  owner_type     text NOT NULL DEFAULT 'private' CHECK (owner_type IN ('state_forfeited', 'city', 'public', 'private')),
  owner_estate_heirs boolean NOT NULL DEFAULT false,
  source_edited_at timestamptz,      -- layer's last edit date: "owner as of" for parcel-map-only parcels
  tv_land        numeric,
  tv_imp         numeric,
  ass_land       numeric,
  ass_imp        numeric,
  homestead_app  text,               -- he_1: homestead exemption application number
  tax_dist       text,
  land_use_code  text,
  bldg_cond      text,
  bldg_year      integer,
  sales_date     text,
  sales_amt      numeric,
  loc_num        integer,
  loc_street     text,               -- normalized loc_ns + loc_alpha
  acres_gis      numeric,
  part_count     integer NOT NULL DEFAULT 1,  -- source features merged into this parcel
  row_hash       text NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  retired_at     timestamptz,
  PRIMARY KEY (county, parcel_id)
);
CREATE INDEX ON data.gis_parcels USING gist (geom);
CREATE INDEX ON data.gis_parcels USING gist (geom_3857);
CREATE INDEX ON data.gis_parcels USING gist (pt);
CREATE INDEX ON data.gis_parcels (county, loc_street, loc_num);

-- Raw page staging for the resumable GIS pull (one row per source feature).
CREATE TABLE data.gis_parcels_stage (
  run_id     uuid NOT NULL,
  objectid   integer NOT NULL,
  parcel_id  text,
  attrs      jsonb NOT NULL,
  geom       geometry(Geometry, 4326),
  PRIMARY KEY (run_id, objectid)
);

-- Field-level change log for land roll + GIS. Feeds admin "suggestions" (ownership transfer,
-- improvement value dropping to zero). Never auto-applied to parcel status.
CREATE TABLE data.parcel_field_changes (
  id          bigserial PRIMARY KEY,
  county      text NOT NULL,
  parcel_id   text NOT NULL,
  source      text NOT NULL CHECK (source IN ('landroll', 'gis')),
  field       text NOT NULL,
  old_value   text,
  new_value   text,
  run_id      uuid NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON data.parcel_field_changes (county, parcel_id);
CREATE INDEX ON data.parcel_field_changes (field, detected_at DESC);

-- Boundaries ------------------------------------------------------------------------------

CREATE TABLE data.boundaries (
  kind        text NOT NULL CHECK (kind IN ('city_limits', 'city_limits_tiger', 'ward', 'neighborhood', 'zip', 'tract')),
  code        text NOT NULL,
  name        text NOT NULL,
  unofficial  boolean NOT NULL DEFAULT false,
  source      text NOT NULL,
  source_url  text NOT NULL,
  props       jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom        geometry(MultiPolygon, 4326) NOT NULL,
  loaded_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, code)
);
CREATE INDEX ON data.boundaries USING gist (geom);

-- Geocodes for land roll parcels with no GIS polygon -------------------------------------

CREATE TABLE data.geocodes (
  county         text NOT NULL,
  parcel_id      text NOT NULL,
  method         text NOT NULL CHECK (method IN ('gis_situs_match', 'gis_parent_parcel', 'census', 'none')),
  input_address  text NOT NULL,
  matched        text,
  pt             geometry(Point, 4326),
  geocoded_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (county, parcel_id)
);
