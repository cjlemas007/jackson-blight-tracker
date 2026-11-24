-- LOGIC LAYER: count parcel-map parcels that have no owner of record.
--
-- About 2,330 shapes on the County parcel map carry no owner, address or value, and the BigQuery land
-- roll doesn't list them (59-10-10 at 1610 N Mill St and 161-37-22 at 2029 Barrett Ave, both cited
-- by Code Enforcement). None overlaps an owned parcel, so they are separate lots the County's records
-- are missing, not leftover shapes. The newsroom wants every parcel on the map: they now count, with
-- owner unknown (no portfolio, so they never appear in owner rankings). IDs on map number 0 ("00-1")
-- are placeholders and stay out.

CREATE OR REPLACE VIEW app.parcel_universe AS
SELECT l.county, l.parcel_id, 'land_roll'::text AS source
FROM data.landroll_parcels l
WHERE l.retired_at IS NULL
UNION ALL
SELECT g.county, g.parcel_id, 'parcel_map'::text
FROM data.gis_parcels g
WHERE g.retired_at IS NULL
  AND g.parcel_id !~ '^0+-'
  AND NOT EXISTS (SELECT 1 FROM data.landroll_parcels l
                  WHERE l.county = g.county AND l.parcel_id = g.parcel_id AND l.retired_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM data.geocodes c
                  JOIN data.landroll_parcels l ON l.county = c.county AND l.parcel_id = c.parcel_id AND l.retired_at IS NULL
                  WHERE c.county = g.county AND c.matched = g.parcel_id
                    AND upper(btrim(l.owner_name)) = upper(btrim(g.owner_name_gis))
                    AND l.situs_number IS NOT DISTINCT FROM g.loc_num);
