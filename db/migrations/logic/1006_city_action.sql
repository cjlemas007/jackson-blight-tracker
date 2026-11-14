-- LOGIC LAYER: city-action entry, record imports, land-roll suggestions, State inventory (build step 5).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Documents ---------------------------------------------------------------------------------
-- Agendas and city records can be public (linked from the status timeline); raw CSVs obtained by
-- records request stay private by default.
ALTER TABLE app.documents
  ADD COLUMN public boolean NOT NULL DEFAULT false,
  ADD COLUMN title text,
  ADD COLUMN document_date date,
  ADD COLUMN uploaded_at timestamptz;
ALTER TABLE app.documents DROP CONSTRAINT documents_kind_check;
ALTER TABLE app.documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('photo', 'pdf', 'csv', 'image', 'other'));

-- Trigram index for fuzzy address matching of imported rows.
CREATE INDEX parcel_facts_situs_trgm ON app.parcel_facts USING gin (situs_address gin_trgm_ops);

-- Import batches ----------------------------------------------------------------------------
-- One upload (demolition list, code-enforcement log, council agenda, SOS forfeited list) becomes a
-- batch of rows. Rows are matched to parcels; unmatched/ambiguous rows wait for an admin; nothing
-- is written to status history until the admin applies the batch.
CREATE TABLE app.import_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('demolition_list', 'code_enforcement', 'council_agenda', 'sos_forfeited')),
  title         text NOT NULL,
  document_id   uuid REFERENCES app.documents (id),
  status        text NOT NULL DEFAULT 'mapping' CHECK (status IN ('mapping', 'review', 'applied', 'discarded')),
  headers       text[],                       -- CSV header row
  mapping       jsonb,                        -- {parcel_id, address, date, note} -> column names
  default_date  date,
  event_status  app.parcel_status,            -- what applying writes (not used for sos_forfeited)
  event_substatus text,
  source        app.event_source,
  created_by    uuid NOT NULL REFERENCES app.staff (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  applied_by    uuid REFERENCES app.staff (id),
  applied_at    timestamptz,
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE app.import_rows (
  id               bigserial PRIMARY KEY,
  batch_id         uuid NOT NULL REFERENCES app.import_batches (id) ON DELETE CASCADE,
  row_num          integer NOT NULL,
  raw              jsonb NOT NULL,
  input_parcel_id  text,
  input_address    text,
  event_date       date,
  event_substatus  text,                      -- per-row override of the batch's substatus
  note             text,
  match_county     text,
  match_parcel_id  text,
  match_method     text CHECK (match_method IN ('parcel_id', 'dpin', 'address_exact', 'address_fuzzy', 'manual')),
  match_score      real,
  candidates       jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision         text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'accepted', 'skipped')),
  applied_event_id bigint REFERENCES app.status_events (id),
  apply_result     text,                      -- 'event', 'duplicate', 'listed', ...
  UNIQUE (batch_id, row_num)
);
CREATE INDEX ON app.import_rows (batch_id, decision);

-- Secretary of State tax-forfeited inventory ---------------------------------------------------
CREATE TABLE app.state_inventory (
  county      text NOT NULL,
  parcel_id   text NOT NULL,
  list_date   date NOT NULL,
  batch_id    uuid NOT NULL REFERENCES app.import_batches (id),
  raw         jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (county, parcel_id, list_date),
  FOREIGN KEY (county, parcel_id) REFERENCES app.parcel_registry (county, parcel_id)
);

-- Parcels on the most recent SOS list.
CREATE VIEW app.state_inventory_latest AS
SELECT i.county, i.parcel_id, i.list_date
FROM app.state_inventory i
WHERE i.list_date = (SELECT max(list_date) FROM app.state_inventory);

-- Land-roll suggestions -----------------------------------------------------------------------
-- Ownership transfers and improvement value dropping to zero on parcels with a public status
-- (verified / city action) are surfaced for an admin. Never applied automatically.
CREATE TABLE app.suggestions (
  id             bigserial PRIMARY KEY,
  change_id      bigint NOT NULL UNIQUE REFERENCES data.parcel_field_changes (id),
  county         text NOT NULL,
  parcel_id      text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('ownership_transfer', 'improvement_zeroed')),
  details        jsonb NOT NULL,
  detected_at    timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  resolved_by    uuid REFERENCES app.staff (id),
  resolved_at    timestamptz,
  resolution_note text,
  event_id       bigint REFERENCES app.status_events (id)
);
CREATE INDEX ON app.suggestions (status, detected_at DESC);

CREATE FUNCTION app.refresh_suggestions() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  INSERT INTO app.suggestions (change_id, county, parcel_id, kind, details, detected_at)
  SELECT c.id, c.county, c.parcel_id,
         CASE WHEN c.field = 'owner_name' THEN 'ownership_transfer' ELSE 'improvement_zeroed' END,
         jsonb_build_object('field', c.field, 'old', c.old_value, 'new', c.new_value),
         c.detected_at
  FROM data.parcel_field_changes c
  JOIN app.parcel_status_current s ON s.county = c.county AND s.parcel_id = c.parcel_id
  WHERE s.status IN ('verified_blighted', 'city_action')
    AND (
      (c.field = 'owner_name' AND c.old_value IS DISTINCT FROM c.new_value)
      OR (c.field = 'tv_imp' AND COALESCE(c.old_value::numeric, 0) > 0 AND COALESCE(NULLIF(c.new_value, '')::numeric, 0) = 0)
    )
  ON CONFLICT (change_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Nightly rebuild also refreshes suggestions.
CREATE OR REPLACE FUNCTION app.rebuild_parcel_facts() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM app.refresh_parcel_registry();
  PERFORM app.assign_areas();
  REFRESH MATERIALIZED VIEW app.parcel_facts;
  PERFORM app.refresh_suggestions();
  SELECT count(*) INTO n FROM app.parcel_facts;
  RETURN n;
END $$;

-- City response ----------------------------------------------------------------------------
-- Per parcel: first verification, first city action after it, first resolution after it.
CREATE VIEW app.parcel_milestones AS
WITH v AS (
  SELECT county, parcel_id, min(effective_date) AS verified_on
  FROM app.status_events_live WHERE status = 'verified_blighted' GROUP BY 1, 2
)
SELECT v.county, v.parcel_id, v.verified_on,
       (SELECT min(e.effective_date) FROM app.status_events_live e
         WHERE e.county = v.county AND e.parcel_id = v.parcel_id AND e.status = 'city_action'
           AND e.effective_date >= v.verified_on) AS first_action_on,
       (SELECT min(e.effective_date) FROM app.status_events_live e
         WHERE e.county = v.county AND e.parcel_id = v.parcel_id AND e.status = 'resolved'
           AND e.substatus <> 'rejected_on_recheck' AND e.effective_date >= v.verified_on) AS resolved_on
FROM v;

-- Imported city records can put a parcel into city_action without the newsroom ever verifying it.
-- "Blighted" in rankings and counters means newsroom-verified: the parcel must have a verification
-- on or before d. City-only parcels still appear on the City response page and the map.
CREATE OR REPLACE FUNCTION app.blighted_as_of(d date)
RETURNS TABLE (county text, parcel_id text, status app.parcel_status, since date)
LANGUAGE sql STABLE AS $$
  SELECT s.county, s.parcel_id, s.status, s.status_since
  FROM app.status_as_of(d) s
  WHERE s.status IN ('verified_blighted', 'city_action')
    AND EXISTS (SELECT 1 FROM app.status_events_live v
                WHERE v.county = s.county AND v.parcel_id = s.parcel_id
                  AND v.status = 'verified_blighted' AND v.effective_date <= d)
$$;

-- City-flagged parcels ---------------------------------------------------------------------
-- A parcel the City acted on (cited, adjudicated, ...) that the newsroom hasn't verified is
-- "City-flagged": shown separately, never counted as verified blight, and listed for staff to check.

-- Lifecycle rule: a verification recorded while City action is open (no resolution or reset since)
-- marks the parcel verified but doesn't reset its status to verified_blighted; the City action
-- stays the current state. After a resolution, a new verification applies normally (re-blight).
CREATE OR REPLACE FUNCTION app.status_as_of(d date)
RETURNS TABLE (county text, parcel_id text, status app.parcel_status, substatus text, status_since date, event_id bigint)
LANGUAGE sql STABLE AS $$
  WITH ev AS (SELECT * FROM app.status_events_live WHERE effective_date <= d),
  effective AS (
    SELECT e.* FROM ev e
    WHERE NOT (
      e.status = 'verified_blighted' AND EXISTS (
        SELECT 1 FROM ev c
        WHERE c.county = e.county AND c.parcel_id = e.parcel_id AND c.status = 'city_action'
          AND (c.effective_date, c.recorded_at, c.id) < (e.effective_date, e.recorded_at, e.id)
          AND NOT EXISTS (
            SELECT 1 FROM ev r
            WHERE r.county = e.county AND r.parcel_id = e.parcel_id AND r.status IN ('resolved', 'unreported')
              AND (r.effective_date, r.recorded_at, r.id) > (c.effective_date, c.recorded_at, c.id)
              AND (r.effective_date, r.recorded_at, r.id) < (e.effective_date, e.recorded_at, e.id))))
  )
  SELECT DISTINCT ON (x.county, x.parcel_id) x.county, x.parcel_id, x.status, x.substatus, x.effective_date, x.id
  FROM effective x
  ORDER BY x.county, x.parcel_id, x.effective_date DESC, x.recorded_at DESC, x.id DESC
$$;

CREATE FUNCTION app.city_flagged_as_of(d date)
RETURNS TABLE (county text, parcel_id text, substatus text, since date)
LANGUAGE sql STABLE AS $$
  SELECT s.county, s.parcel_id, s.substatus, s.status_since
  FROM app.status_as_of(d) s
  WHERE s.status = 'city_action'
    AND NOT EXISTS (SELECT 1 FROM app.status_events_live v
                    WHERE v.county = s.county AND v.parcel_id = s.parcel_id
                      AND v.status = 'verified_blighted' AND v.effective_date <= d)
$$;

-- ranking_base gains city_flagged (new column at the end).
DROP FUNCTION app.ranking_base(date, integer);
CREATE FUNCTION app.ranking_base(d date, valid_days integer)
RETURNS TABLE (
  county text, parcel_id text, portfolio_id text, owner_type text, ranking_excluded_reason text,
  street_name text, ward text, neighborhood text, tract text, current_due numeric,
  blighted boolean, surveyed boolean, city_flagged boolean
)
LANGUAGE sql STABLE AS $$
  SELECT f.county, f.parcel_id, f.portfolio_id, f.owner_type, f.ranking_excluded_reason,
         f.street_name, f.ward, f.neighborhood, f.tract, f.current_due,
         b.parcel_id IS NOT NULL, s.parcel_id IS NOT NULL, cf.parcel_id IS NOT NULL
  FROM app.parcel_facts f
  LEFT JOIN app.blighted_as_of(d) b ON b.county = f.county AND b.parcel_id = f.parcel_id
  LEFT JOIN app.surveyed_as_of(d, valid_days) s ON s.county = f.county AND s.parcel_id = f.parcel_id
  LEFT JOIN app.city_flagged_as_of(d) cf ON cf.county = f.county AND cf.parcel_id = f.parcel_id
  WHERE f.in_city
$$;

-- The app's parcel view also says whether the newsroom has ever verified the parcel.
CREATE OR REPLACE VIEW app.parcels AS
SELECT f.*,
       COALESCE(s.status, 'unreported') AS status,
       s.substatus, s.status_since,
       EXISTS (SELECT 1 FROM app.status_events_live v
               WHERE v.county = f.county AND v.parcel_id = f.parcel_id AND v.status = 'verified_blighted') AS ever_verified
FROM app.parcel_facts f
LEFT JOIN app.parcel_status_current s USING (county, parcel_id);
