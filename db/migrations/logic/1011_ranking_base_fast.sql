-- LOGIC LAYER: make ranking_base fast once parcels have status history.
--
-- ranking_base left-joined blighted_as_of(d) and city_flagged_as_of(d) to every in-city parcel. The
-- planner couldn't estimate those functions' row counts and compared each of 72k parcels with each
-- of the ~3.6k parcels carrying a status: 263 million comparisons, ~40 s, so the Owners and Streets
-- pages timed out on the live site once the first city records were recorded (2026-11-24).
--
-- Same result, computed once: each parcel's status as of d, whether the newsroom had verified it by
-- d, and whether it was surveyed, each materialized and merged with the parcel list (~0.2 s).
--   blighted      status verified_blighted or city_action, and verified on or before d (blighted_as_of)
--   city_flagged  status city_action, and not verified on or before d (city_flagged_as_of)

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
  sv AS MATERIALIZED (SELECT s.county, s.parcel_id FROM app.surveyed_as_of(d, valid_days) s)
  SELECT f.county, f.parcel_id, f.portfolio_id, f.owner_type, f.ranking_excluded_reason,
         f.street_name, f.ward, f.neighborhood, f.tract, f.current_due,
         COALESCE(st.status IN ('verified_blighted', 'city_action') AND ver.parcel_id IS NOT NULL, false),
         sv.parcel_id IS NOT NULL,
         COALESCE(st.status = 'city_action' AND ver.parcel_id IS NULL, false)
  FROM app.parcel_facts f
  LEFT JOIN st ON st.county = f.county AND st.parcel_id = f.parcel_id
  LEFT JOIN ver ON ver.county = f.county AND ver.parcel_id = f.parcel_id
  LEFT JOIN sv ON sv.county = f.county AND sv.parcel_id = f.parcel_id
  WHERE f.in_city
$$;
