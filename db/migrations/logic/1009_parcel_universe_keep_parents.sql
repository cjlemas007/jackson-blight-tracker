-- LOGIC LAYER: keep parcel-map parcels that 1003 hid as "parents" or "address matches".
--
-- 1003 left out a parcel-map parcel when (a) a land roll parcel's ID was its ID plus a suffix
-- ("170-98-1" hid "170-98"), assuming the children already covered that land, or (b) it was
-- used to locate a land roll parcel that has no shape of its own. Checked against the live data
-- on 2026-11-24, both assumptions were mostly wrong: 318 of 327 hidden "parents" have children
-- with their own shapes, so the parent is the remaining, separate parcel (170-98 is 907 Union St,
-- owned by a foundation; 170-98-1 is 445 W Silas Brown St, owned by someone else), and many
-- "address matches" are a different property next door (Jackson Medical Mall Foundation vs. a
-- lessee's parcel). Many of these are tax-exempt, which is why the land roll lacks them; the
-- newsroom wants every parcel on the map, exempt or not.
--
-- A parcel-map parcel is now left out only when it is the same property already on the land roll
-- under another ID: a land roll parcel located on this shape (it has none of its own) with the
-- same owner and the same house number. Shapes with no owner, address or value stay out.

CREATE OR REPLACE VIEW app.parcel_universe AS
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
  AND NOT EXISTS (SELECT 1 FROM data.geocodes c
                  JOIN data.landroll_parcels l ON l.county = c.county AND l.parcel_id = c.parcel_id AND l.retired_at IS NULL
                  WHERE c.county = g.county AND c.matched = g.parcel_id
                    AND upper(btrim(l.owner_name)) = upper(btrim(g.owner_name_gis))
                    AND l.situs_number IS NOT DISTINCT FROM g.loc_num);
