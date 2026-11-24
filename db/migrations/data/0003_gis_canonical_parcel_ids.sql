-- DATA LAYER: store parcel-map IDs without zero padding.
--
-- The County parcel map writes 1,091 sub-parcel IDs with padding ("59-10-010", "161-37-022") that the
-- land roll and tax records write without it ("59-10-10"). Those shapes never joined their land roll
-- parcels, which were located by their parent lot or the Census geocoder instead, and the shapes
-- themselves (which carry no owner or address) were left off the map. The sync now strips the
-- padding (canonicalParcelId); this fixes the rows already stored. Checked 2026-11-24: no padded ID
-- collides with an unpadded one.

UPDATE data.gis_parcels g
SET parcel_id = regexp_replace(g.parcel_id, '(^|-)0+(?=\d)', '\1', 'g')
WHERE g.parcel_id <> regexp_replace(g.parcel_id, '(^|-)0+(?=\d)', '\1', 'g')
  AND NOT EXISTS (SELECT 1 FROM data.gis_parcels o
                  WHERE o.county = g.county AND o.parcel_id = regexp_replace(g.parcel_id, '(^|-)0+(?=\d)', '\1', 'g'));
