-- LOGIC LAYER: survey coverage and the parcel sets behind rankings and counters (build step 4).
--
-- "Blighted" everywhere means a parcel whose status is verified_blighted or city_action on the
-- date asked about. Resolved parcels (demolished, repaired, lot cleared, rejected on re-check)
-- drop out. Pending submissions never count (nothing is public until approved).

-- Survey records (survey mode, build step 6, fills this). A parcel is "surveyed" when staff
-- looked at it on purpose and recorded blighted / not blighted, which is what makes a rate meaningful.
CREATE TABLE app.parcel_surveys (
  id           bigserial PRIMARY KEY,
  county       text NOT NULL,
  parcel_id    text NOT NULL,
  surveyed_on  date NOT NULL,
  result       text NOT NULL CHECK (result IN ('blighted', 'not_blighted', 'inaccessible')),
  surveyed_by  uuid NOT NULL REFERENCES app.staff (id),
  submission_id uuid REFERENCES app.submissions (id),  -- the photo submission when result = blighted
  note         text,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (county, parcel_id) REFERENCES app.parcel_registry (county, parcel_id)
);
CREATE INDEX ON app.parcel_surveys (county, parcel_id, surveyed_on DESC);
CREATE TRIGGER parcel_surveys_append_only BEFORE UPDATE OR DELETE ON app.parcel_surveys
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- Coverage as of a date: surveyed within `valid_days` before d (inaccessible doesn't count).
CREATE FUNCTION app.surveyed_as_of(d date, valid_days integer)
RETURNS TABLE (county text, parcel_id text, surveyed_on date)
LANGUAGE sql STABLE AS $$
  SELECT s.county, s.parcel_id, max(s.surveyed_on)
  FROM app.parcel_surveys s
  WHERE s.surveyed_on <= d AND s.surveyed_on > d - valid_days AND s.result <> 'inaccessible'
  GROUP BY s.county, s.parcel_id
$$;

-- Parcels blighted at the end of day d.
CREATE FUNCTION app.blighted_as_of(d date)
RETURNS TABLE (county text, parcel_id text, status app.parcel_status, since date)
LANGUAGE sql STABLE AS $$
  SELECT county, parcel_id, status, status_since
  FROM app.status_as_of(d)
  WHERE status IN ('verified_blighted', 'city_action')
$$;

-- Everything a ranking needs about one in-city parcel, as of a date: blighted then? surveyed then?
-- (Ownership and areas are current: the land roll has no history in v1.)
CREATE FUNCTION app.ranking_base(d date, valid_days integer)
RETURNS TABLE (
  county text, parcel_id text, portfolio_id text, owner_type text, ranking_excluded_reason text,
  street_name text, ward text, neighborhood text, tract text, current_due numeric,
  blighted boolean, surveyed boolean
)
LANGUAGE sql STABLE AS $$
  SELECT f.county, f.parcel_id, f.portfolio_id, f.owner_type, f.ranking_excluded_reason,
         f.street_name, f.ward, f.neighborhood, f.tract, f.current_due,
         b.parcel_id IS NOT NULL, s.parcel_id IS NOT NULL
  FROM app.parcel_facts f
  LEFT JOIN app.blighted_as_of(d) b ON b.county = f.county AND b.parcel_id = f.parcel_id
  LEFT JOIN app.surveyed_as_of(d, valid_days) s ON s.county = f.county AND s.parcel_id = f.parcel_id
  WHERE f.in_city
$$;
