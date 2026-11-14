-- LOGIC LAYER: parcel lifecycle. Status history is append-only; every statistic is a query
-- over it ("demolished this week" is never a typed number).

CREATE SCHEMA IF NOT EXISTS app;

-- Every parcel id ever counted, from either source. Never deleted, so status history
-- always has a parent row even if a parcel later leaves the land roll or parcel map.
-- Filled by app.refresh_parcel_registry() (1003_parcels.sql) during the nightly rebuild.
CREATE TABLE app.parcel_registry (
  county         text NOT NULL,
  parcel_id      text NOT NULL,
  source         text NOT NULL CHECK (source IN ('land_roll', 'parcel_map')),  -- latest source
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (county, parcel_id)
);

CREATE TYPE app.parcel_status AS ENUM
  ('unreported', 'submitted', 'verified_blighted', 'city_action', 'resolved');

CREATE TYPE app.event_source AS ENUM
  ('user_photo', 'admin_entry', 'city_record', 'council_agenda', 'survey', 'land_roll');

-- Uploaded photos and documents (object storage keys; files live outside the database).
CREATE TABLE app.documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('photo', 'pdf', 'csv', 'other')),
  storage_key   text NOT NULL UNIQUE,
  original_name text,
  mime_type     text,
  bytes         integer,
  sha256        text,
  uploaded_by   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.status_events (
  id             bigserial PRIMARY KEY,
  county         text NOT NULL,
  parcel_id      text NOT NULL,
  status         app.parcel_status NOT NULL,
  substatus      text,
  effective_date date NOT NULL,                 -- when it happened (may be backdated from a record)
  recorded_at    timestamptz NOT NULL DEFAULT now(),  -- when we learned of it
  source         app.event_source NOT NULL,
  document_id    uuid REFERENCES app.documents (id),
  note           text,
  recorded_by    text NOT NULL,
  FOREIGN KEY (county, parcel_id) REFERENCES app.parcel_registry (county, parcel_id),
  -- Every branch must be TRUE/FALSE, never NULL (a NULL CHECK passes), hence the IS NOT NULLs.
  CONSTRAINT substatus_matches_status CHECK (
    (status = 'city_action' AND substatus IS NOT NULL AND substatus IN
      ('cited', 'hearing_set', 'adjudicated', 'demolition_ordered', 'lot_cleanup_ordered', 'lien_filed'))
    OR (status = 'resolved' AND substatus IS NOT NULL AND substatus IN ('demolished', 'repaired', 'lot_cleared', 'rejected_on_recheck'))
    OR (status IN ('unreported', 'submitted', 'verified_blighted') AND substatus IS NULL)
  )
);
CREATE INDEX ON app.status_events (county, parcel_id, effective_date DESC, recorded_at DESC, id DESC);
CREATE INDEX ON app.status_events (status, substatus, effective_date);

-- Mistaken entries are voided, not edited or deleted. The void itself is a dated record.
CREATE TABLE app.status_event_voids (
  event_id   bigint PRIMARY KEY REFERENCES app.status_events (id),
  reason     text NOT NULL,
  voided_by  text NOT NULL,
  voided_at  timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION app.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; record a new event or a void instead', TG_TABLE_NAME;
END $$;

CREATE TRIGGER status_events_append_only BEFORE UPDATE OR DELETE ON app.status_events
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER status_event_voids_append_only BEFORE UPDATE OR DELETE ON app.status_event_voids
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- Live (non-voided) events.
CREATE VIEW app.status_events_live AS
SELECT e.* FROM app.status_events e
WHERE NOT EXISTS (SELECT 1 FROM app.status_event_voids v WHERE v.event_id = e.id);

-- Status of every parcel that has any history, as of the end of day `d`.
-- Latest effective_date wins; ties go to the later recording.
-- Parcels with no events are 'unreported' (callers LEFT JOIN and COALESCE).
CREATE FUNCTION app.status_as_of(d date)
RETURNS TABLE (county text, parcel_id text, status app.parcel_status, substatus text, status_since date, event_id bigint)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (e.county, e.parcel_id)
         e.county, e.parcel_id, e.status, e.substatus, e.effective_date, e.id
  FROM app.status_events_live e
  WHERE e.effective_date <= d
  ORDER BY e.county, e.parcel_id, e.effective_date DESC, e.recorded_at DESC, e.id DESC
$$;

CREATE VIEW app.parcel_status_current AS
SELECT * FROM app.status_as_of('infinity'::date);

-- Parcels that FIRST reached a status (optionally a sub-status) within [from_d, to_d).
-- A parcel demolished once counts once, even if two sources record the demolition.
-- This is the primitive behind "demolished this week", "verified this month", etc.
CREATE FUNCTION app.first_entries(p_status app.parcel_status, p_substatus text, from_d date, to_d date)
RETURNS TABLE (county text, parcel_id text, entered_on date)
LANGUAGE sql STABLE AS $$
  WITH firsts AS (
    SELECT e.county, e.parcel_id, min(e.effective_date) AS entered_on
    FROM app.status_events_live e
    WHERE e.status = p_status AND (p_substatus IS NULL OR e.substatus = p_substatus)
    GROUP BY e.county, e.parcel_id
  )
  SELECT f.county, f.parcel_id, f.entered_on FROM firsts f
  WHERE f.entered_on >= from_d AND f.entered_on < to_d
$$;

-- Monday-start weeks (ISO) in Central time.
CREATE FUNCTION app.week_start(ts timestamptz DEFAULT now())
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT date_trunc('week', (ts AT TIME ZONE 'America/Chicago'))::date
$$;
