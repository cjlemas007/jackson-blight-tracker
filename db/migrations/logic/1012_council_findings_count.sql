-- LOGIC LAYER: a City Council menace finding counts as blight.
--
-- Until now only newsroom-verified parcels counted as blighted; parcels the City acted on were shown
-- separately as "City-flagged". On 2026-11-24 the newsroom decided that a council finding (the
-- Council adjudicating the property a menace to public health and safety under Miss. Code 21-19-11,
-- or ordering it demolished) is itself a finding of blight, and counts it, labeled as a council
-- finding. A Code Enforcement citation alone (a case opened, no finding) stays City-flagged.
--
-- A finding counts from its date until a later resolution (demolished, repaired, cleared) or reset.
-- City response times still measure only newsroom-verified parcels (app.parcel_milestones).

-- Parcels with a council finding not since resolved, as of d, with the date of the latest finding.
CREATE FUNCTION app.council_found_as_of(d date)
RETURNS TABLE (county text, parcel_id text, found_on date)
LANGUAGE sql STABLE AS $$
  SELECT f.county, f.parcel_id, max(f.effective_date)
  FROM app.status_events_live f
  WHERE f.status = 'city_action' AND f.substatus IN ('adjudicated', 'demolition_ordered') AND f.effective_date <= d
    AND NOT EXISTS (SELECT 1 FROM app.status_events_live r
                    WHERE r.county = f.county AND r.parcel_id = f.parcel_id AND r.status IN ('resolved', 'unreported')
                      AND r.effective_date <= d
                      AND (r.effective_date, r.recorded_at, r.id) > (f.effective_date, f.recorded_at, f.id))
  GROUP BY f.county, f.parcel_id
$$;

CREATE OR REPLACE FUNCTION app.blighted_as_of(d date)
RETURNS TABLE (county text, parcel_id text, status app.parcel_status, since date)
LANGUAGE sql STABLE AS $$
  SELECT s.county, s.parcel_id, s.status, s.status_since
  FROM app.status_as_of(d) s
  WHERE s.status IN ('verified_blighted', 'city_action')
    AND (EXISTS (SELECT 1 FROM app.status_events_live v
                 WHERE v.county = s.county AND v.parcel_id = s.parcel_id
                   AND v.status = 'verified_blighted' AND v.effective_date <= d)
         OR EXISTS (SELECT 1 FROM app.council_found_as_of(d) c WHERE c.county = s.county AND c.parcel_id = s.parcel_id))
$$;

CREATE OR REPLACE FUNCTION app.city_flagged_as_of(d date)
RETURNS TABLE (county text, parcel_id text, substatus text, since date)
LANGUAGE sql STABLE AS $$
  SELECT s.county, s.parcel_id, s.substatus, s.status_since
  FROM app.status_as_of(d) s
  WHERE s.status = 'city_action'
    AND NOT EXISTS (SELECT 1 FROM app.status_events_live v
                    WHERE v.county = s.county AND v.parcel_id = s.parcel_id
                      AND v.status = 'verified_blighted' AND v.effective_date <= d)
    AND NOT EXISTS (SELECT 1 FROM app.council_found_as_of(d) c WHERE c.county = s.county AND c.parcel_id = s.parcel_id)
$$;

-- Same shape and speed as 1011, with council findings counted.
CREATE OR REPLACE FUNCTION app.ranking_base(d date, valid_days integer)
RETURNS TABLE (
  county text, parcel_id text, portfolio_id text, owner_type text, ranking_excluded_reason text,
  street_name text, ward text, neighborhood text, tract text, current_due numeric,
  blighted boolean, surveyed boolean, city_flagged boolean
)
LANGUAGE sql STABLE AS $$
  WITH st AS MATERIALIZED (SELECT s.county, s.parcel_id, s.status FROM app.status_as_of(d) s),
  ver AS MATERIALIZED (
    SELECT DISTINCT v.county, v.parcel_id FROM app.status_events_live v
    WHERE v.status = 'verified_blighted' AND v.effective_date <= d
  ),
  cf AS MATERIALIZED (SELECT c.county, c.parcel_id FROM app.council_found_as_of(d) c),
  sv AS MATERIALIZED (SELECT s.county, s.parcel_id FROM app.surveyed_as_of(d, valid_days) s)
  SELECT f.county, f.parcel_id, f.portfolio_id, f.owner_type, f.ranking_excluded_reason,
         f.street_name, f.ward, f.neighborhood, f.tract, f.current_due,
         COALESCE(st.status IN ('verified_blighted', 'city_action') AND (ver.parcel_id IS NOT NULL OR cf.parcel_id IS NOT NULL), false),
         sv.parcel_id IS NOT NULL,
         COALESCE(st.status = 'city_action' AND ver.parcel_id IS NULL AND cf.parcel_id IS NULL, false)
  FROM app.parcel_facts f
  LEFT JOIN st ON st.county = f.county AND st.parcel_id = f.parcel_id
  LEFT JOIN ver ON ver.county = f.county AND ver.parcel_id = f.parcel_id
  LEFT JOIN cf ON cf.county = f.county AND cf.parcel_id = f.parcel_id
  LEFT JOIN sv ON sv.county = f.county AND sv.parcel_id = f.parcel_id
  WHERE f.in_city
$$;

-- The app's parcel view also gives the date of a standing council finding (NULL when none).
CREATE OR REPLACE VIEW app.parcels AS
SELECT f.*,
       COALESCE(s.status, 'unreported') AS status,
       s.substatus, s.status_since,
       EXISTS (SELECT 1 FROM app.status_events_live v
               WHERE v.county = f.county AND v.parcel_id = f.parcel_id AND v.status = 'verified_blighted') AS ever_verified,
       cf.found_on AS council_found_on
FROM app.parcel_facts f
LEFT JOIN app.parcel_status_current s USING (county, parcel_id)
LEFT JOIN app.council_found_as_of('infinity'::date) cf USING (county, parcel_id);
