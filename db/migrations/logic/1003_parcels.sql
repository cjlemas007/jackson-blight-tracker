-- LOGIC LAYER: the parcel universe, area/street assignment, owner portfolios, and the
-- parcel fact table the app reads. Rebuilt nightly by app.rebuild_parcel_facts().

-- Parcel universe ------------------------------------------------------------------------
-- The BigQuery land roll is missing ~8.6k parcels that the county parcel map has: exempt
-- public land, but also ordinary taxable homes the scrape never captured. Count:
--   * every active land roll parcel, and
--   * every active parcel-map parcel with an owner of record that is not on the land roll,
--     EXCEPT a parent whose children are on the land roll (the children already cover that
--     land) and a parcel already used to locate a land roll parcel by address.
-- Parcel-map shapes with no attributes at all (~3.4k: no owner, address or value) are left out.

CREATE VIEW app.parcel_universe AS
SELECT l.county, l.parcel_id, 'land_roll'::text AS source
FROM data.landroll_parcels l
WHERE l.retired_at IS NULL
UNION ALL
SELECT g.county, g.parcel_id, 'parcel_map'::text
FROM data.gis_parcels g
WHERE g.retired_at IS NULL
  AND g.owner_name_gis IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM data.landroll_parcels l
                  WHERE l.county = g.county AND l.parcel_id = g.parcel_id AND l.retired_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM data.landroll_parcels l
                  WHERE l.county = g.county AND l.retired_at IS NULL
                    AND regexp_replace(l.parcel_id, '-[^-]+$', '') = g.parcel_id)
  AND NOT EXISTS (SELECT 1 FROM data.geocodes c WHERE c.county = g.county AND c.matched = g.parcel_id);

CREATE FUNCTION app.refresh_parcel_registry() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO app.parcel_registry (county, parcel_id, source)
  SELECT county, parcel_id, source FROM app.parcel_universe
  ON CONFLICT (county, parcel_id) DO UPDATE SET source = EXCLUDED.source
    WHERE app.parcel_registry.source IS DISTINCT FROM EXCLUDED.source;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Area assignment ------------------------------------------------------------------------

CREATE TABLE app.parcel_areas (
  county           text NOT NULL,
  parcel_id        text NOT NULL,
  location_source  text NOT NULL CHECK (location_source IN ('gis_polygon', 'gis_situs_match', 'gis_parent_parcel', 'census', 'none')),
  pt               geometry(Point, 4326),
  in_city          boolean NOT NULL DEFAULT false,
  ward             text,
  neighborhood     text,
  zip              text,
  tract            text,
  street_name      text,          -- normalized; key for street rankings
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (county, parcel_id)
);
CREATE INDEX ON app.parcel_areas USING gist (pt);
CREATE INDEX ON app.parcel_areas (in_city, ward);
CREATE INDEX ON app.parcel_areas (in_city, neighborhood);
CREATE INDEX ON app.parcel_areas (in_city, tract);
CREATE INDEX ON app.parcel_areas (in_city, street_name);

CREATE FUNCTION app.assign_areas() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  TRUNCATE app.parcel_areas;
  INSERT INTO app.parcel_areas
    (county, parcel_id, location_source, pt, in_city, ward, neighborhood, zip, tract, street_name)
  SELECT u.county, u.parcel_id,
         CASE WHEN g.parcel_id IS NOT NULL THEN 'gis_polygon'
              WHEN gc.pt IS NOT NULL THEN gc.method
              ELSE 'none' END,
         loc.pt,
         COALESCE(city.hit, false),
         ward.code, nb.code, zip.code, tract.code,
         COALESCE(g.loc_street, l.situs_street)
  FROM app.parcel_universe u
  LEFT JOIN data.landroll_parcels l ON l.county = u.county AND l.parcel_id = u.parcel_id
  LEFT JOIN data.gis_parcels g
         ON g.county = u.county AND g.parcel_id = u.parcel_id AND g.retired_at IS NULL
  LEFT JOIN data.geocodes gc
         ON gc.county = u.county AND gc.parcel_id = u.parcel_id AND gc.pt IS NOT NULL
  CROSS JOIN LATERAL (SELECT COALESCE(g.pt, gc.pt) AS pt) loc
  LEFT JOIN LATERAL (SELECT true AS hit FROM data.boundaries b
                     WHERE b.kind = 'city_limits' AND ST_Intersects(b.geom, loc.pt) LIMIT 1) city ON true
  LEFT JOIN LATERAL (SELECT b.code FROM data.boundaries b
                     WHERE b.kind = 'ward' AND ST_Intersects(b.geom, loc.pt) LIMIT 1) ward ON true
  LEFT JOIN LATERAL (SELECT b.code FROM data.boundaries b
                     WHERE b.kind = 'neighborhood' AND ST_Intersects(b.geom, loc.pt) LIMIT 1) nb ON true
  LEFT JOIN LATERAL (SELECT b.code FROM data.boundaries b
                     WHERE b.kind = 'zip' AND ST_Intersects(b.geom, loc.pt) LIMIT 1) zip ON true
  LEFT JOIN LATERAL (SELECT b.code FROM data.boundaries b
                     WHERE b.kind = 'tract' AND ST_Intersects(b.geom, loc.pt) LIMIT 1) tract ON true;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Owner portfolios ------------------------------------------------------------------------
-- Resolution order is documented in 1002_portfolios.sql. Public owners group by type/name.

CREATE VIEW app.parcel_owner AS
WITH base AS (
  SELECT u.county, u.parcel_id, u.source,
         COALESCE(l.owner_name, g.owner_name_gis) AS owner_name,
         COALESCE(l.owner_type, g.owner_type) AS owner_type,
         COALESCE(l.owner_estate_heirs, g.owner_estate_heirs) AS owner_estate_heirs,
         l.mailing_key, l.mailing_street_key,
         (l.parcel_id IS NOT NULL AND COALESCE(l.mailing_city, '') = '' AND COALESCE(l.mailing_state, '') = '') AS mailing_lost_city
  FROM app.parcel_universe u
  LEFT JOIN data.landroll_parcels l ON l.county = u.county AND l.parcel_id = u.parcel_id
  LEFT JOIN data.gis_parcels g ON g.county = u.county AND g.parcel_id = u.parcel_id
), street_keys AS (
  -- street-line fallback is safe only when that street line maps to exactly one portfolio
  SELECT split_part(mailing_key, '|', 1) AS street_key, min(portfolio_id) AS portfolio_id
  FROM app.portfolio_mailing_keys
  GROUP BY 1 HAVING count(DISTINCT portfolio_id) = 1
), resolved AS (
  SELECT b.*,
         ov.portfolio_id AS ov_pid, mk.portfolio_id AS mk_pid, sk.portfolio_id AS sk_pid,
         mk.entity_status
  FROM base b
  LEFT JOIN app.portfolio_owner_overrides ov ON ov.owner_name = upper(btrim(b.owner_name))
  LEFT JOIN app.portfolio_mailing_keys mk ON mk.mailing_key = b.mailing_key
  LEFT JOIN street_keys sk ON b.mailing_lost_city AND sk.street_key = b.mailing_street_key
)
SELECT r.county, r.parcel_id, r.source, r.owner_name, r.owner_type, r.owner_estate_heirs,
       CASE
         WHEN r.owner_type = 'state_forfeited' THEN 'STATE_OF_MISSISSIPPI'
         WHEN r.owner_type = 'city' THEN 'CITY_OF_JACKSON'
         WHEN r.owner_type = 'public' THEN 'PUB:' || upper(btrim(r.owner_name))
         ELSE COALESCE(r.ov_pid, r.mk_pid, r.sk_pid,
                       CASE WHEN r.mailing_key IS NOT NULL THEN 'MK:' || r.mailing_key
                            ELSE 'OWN:' || upper(btrim(r.owner_name)) END)
       END AS portfolio_id,
       CASE
         WHEN r.owner_type IN ('state_forfeited', 'city', 'public') THEN 'owner_type'
         WHEN r.ov_pid IS NOT NULL THEN 'override'
         WHEN r.mk_pid IS NOT NULL THEN 'mailing_key'
         WHEN r.sk_pid IS NOT NULL THEN 'mailing_street'
         WHEN r.mailing_key IS NOT NULL THEN 'derived_mailing_key'
         ELSE 'derived_owner_name'
       END AS portfolio_source,
       p.display_name AS attributed_owner,
       r.entity_status
FROM resolved r
LEFT JOIN app.portfolios p ON p.portfolio_id = COALESCE(r.ov_pid, r.mk_pid, r.sk_pid);

-- Parcel facts (materialized; rebuilt nightly) ---------------------------------------------

CREATE MATERIALIZED VIEW app.parcel_facts AS
SELECT o.county, o.parcel_id,
       o.source AS owner_source,                   -- 'land_roll' or 'parcel_map'
       (o.source = 'land_roll') AS on_tax_roll,
       o.owner_name, o.portfolio_id, o.portfolio_source, o.attributed_owner, o.entity_status,
       o.owner_type, o.owner_estate_heirs,
       (g.homestead_app IS NOT NULL) AS homestead,
       CASE WHEN g.homestead_app IS NOT NULL THEN 'homestead'
            WHEN o.owner_estate_heirs THEN 'estate_heirs' END AS ranking_excluded_reason,
       l.mailing_care_of, l.mailing_street, l.mailing_city, l.mailing_state, l.mailing_zip,
       COALESCE(l.situs_address, NULLIF(concat_ws(' ', g.loc_num, g.loc_street), '')) AS situs_address,
       a.street_name,
       COALESCE(l.situs_number, g.loc_num) AS situs_number,
       COALESCE(l.appraised_total, NULLIF(COALESCE(g.tv_land, 0) + COALESCE(g.tv_imp, 0), 0)) AS appraised_total,
       COALESCE(l.assessed_total, NULLIF(COALESCE(g.ass_land, 0) + COALESCE(g.ass_imp, 0), 0)) AS assessed_total,
       COALESCE(l.acreage, g.acres_gis) AS acreage,
       l.deed_date,
       COALESCE(l.year_built, g.bldg_year) AS year_built,
       g.tv_land, g.tv_imp, g.land_use_code, g.bldg_cond,
       -- Tax: NULL means no tax record (not "paid"). Parcel-map-only parcels never have one.
       t.current_due, t.latest_tax_year,
       CASE WHEN t.parcel_id IS NULL THEN NULL ELSE t.current_due > 0 END AS delinquent,
       COALESCE(cardinality(t.unpaid_years), 0) AS unpaid_year_count,
       a.in_city, a.ward, a.neighborhood, a.zip, a.tract, a.location_source, a.pt,
       (g.parcel_id IS NOT NULL) AS has_polygon,
       COALESCE(l.source_loaded_at, g.source_edited_at) AS owner_as_of
FROM app.parcel_owner o
LEFT JOIN data.landroll_parcels l ON l.county = o.county AND l.parcel_id = o.parcel_id
LEFT JOIN app.parcel_areas a ON a.county = o.county AND a.parcel_id = o.parcel_id
LEFT JOIN data.gis_parcels g ON g.county = o.county AND g.parcel_id = o.parcel_id AND g.retired_at IS NULL
LEFT JOIN data.parcel_tax t ON t.county = o.county AND t.parcel_id = o.parcel_id
WITH NO DATA;

CREATE UNIQUE INDEX ON app.parcel_facts (county, parcel_id);
CREATE INDEX ON app.parcel_facts (in_city, owner_type);
CREATE INDEX ON app.parcel_facts (portfolio_id);
CREATE INDEX ON app.parcel_facts (in_city, street_name);
CREATE INDEX ON app.parcel_facts USING gist (pt);

-- What the app reads: facts + current lifecycle status.
CREATE VIEW app.parcels AS
SELECT f.*,
       COALESCE(s.status, 'unreported') AS status,
       s.substatus, s.status_since
FROM app.parcel_facts f
LEFT JOIN app.parcel_status_current s USING (county, parcel_id);

CREATE FUNCTION app.rebuild_parcel_facts() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM app.refresh_parcel_registry();
  PERFORM app.assign_areas();
  REFRESH MATERIALIZED VIEW app.parcel_facts;
  SELECT count(*) INTO n FROM app.parcel_facts;
  RETURN n;
END $$;
