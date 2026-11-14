-- LOGIC LAYER: staff accounts, photo submissions, review, audit log (build step 3).
-- Submitting is staff-only (docs/STEP3_DECISIONS.md). Nothing is public until an admin approves.

CREATE EXTENSION IF NOT EXISTS citext;

-- Staff accounts --------------------------------------------------------------------------

CREATE TABLE app.staff (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE,
  name                  text NOT NULL,
  role                  text NOT NULL CHECK (role IN ('contributor', 'admin')),
  password_hash         text NOT NULL,          -- scrypt, see src/lib/auth/password.ts
  must_change_password  boolean NOT NULL DEFAULT true,
  active                boolean NOT NULL DEFAULT true,
  created_by            uuid REFERENCES app.staff (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz
);

-- Session tokens are random; only their SHA-256 is stored.
CREATE TABLE app.sessions (
  token_hash   text PRIMARY KEY,
  staff_id     uuid NOT NULL REFERENCES app.staff (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.sessions (staff_id);

CREATE TABLE app.login_attempts (
  id            bigserial PRIMARY KEY,
  email         citext NOT NULL,
  ok            boolean NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.login_attempts (email, attempted_at DESC);

-- Audit log: who did what, when. Append-only.
CREATE TABLE app.audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor_id   uuid REFERENCES app.staff (id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ON app.audit_log (entity, entity_id, at DESC);
CREATE INDEX ON app.audit_log (actor_id, at DESC);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- Submissions -----------------------------------------------------------------------------

CREATE TABLE app.submissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  county             text NOT NULL,
  parcel_id          text NOT NULL,
  submitted_by       uuid NOT NULL REFERENCES app.staff (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  submitted_at       timestamptz,
  -- draft: photos uploading. processing: EXIF/blur running. pending: in the admin queue.
  -- needs_photo: admin asked for a better photo. approved / rejected: final.
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'processing', 'pending', 'needs_photo', 'approved', 'rejected')),
  -- initial: parcel not yet verified when submitted. follow_up: adds to a verified parcel's timeline.
  kind               text CHECK (kind IN ('initial', 'follow_up')),
  conditions         text[] NOT NULL DEFAULT '{}' CHECK (conditions <@ ARRAY[
                       'vacant_open', 'fire_damage', 'structural_collapse', 'overgrown', 'dumping',
                       'boarded', 'vacant_lot_overgrown_dumping']::text[]),
  note               text CHECK (char_length(note) <= 300),
  vantage_confirmed  boolean NOT NULL DEFAULT false,  -- street, sidewalk, or own property
  reviewed_by        uuid REFERENCES app.staff (id),
  reviewed_at        timestamptz,
  review_reason      text,                            -- rejection reason / photo request
  review_checklist   jsonb,                           -- approval standard items ticked
  FOREIGN KEY (county, parcel_id) REFERENCES app.parcel_registry (county, parcel_id),
  CHECK (status = 'draft' OR vantage_confirmed),
  CHECK (status = 'draft' OR cardinality(conditions) > 0)
);
CREATE INDEX ON app.submissions (status, submitted_at);
CREATE INDEX ON app.submissions (county, parcel_id, submitted_at DESC);
CREATE INDEX ON app.submissions (submitted_by, created_at DESC);

CREATE TABLE app.photos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id     uuid NOT NULL REFERENCES app.submissions (id) ON DELETE CASCADE,
  position          smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
  original_key      text NOT NULL UNIQUE,      -- private bucket; never served publicly
  processed_key     text UNIQUE,               -- EXIF-stripped, blurred
  original_name     text,
  mime_type         text,
  bytes             integer,
  sha256            text,
  width             integer,
  height            integer,
  exif_taken_at     timestamptz,
  exif_pt           geometry(Point, 4326),     -- where the camera says it was
  exif_camera       text,
  auto_boxes        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- detector output: [{x,y,w,h,kind,score}] in 0..1
  manual_boxes      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- admin-drawn: [{x,y,w,h}] in 0..1
  detector          text,                      -- which detector ran, or 'unavailable'
  processing_status text NOT NULL DEFAULT 'uploading'
                    CHECK (processing_status IN ('uploading', 'queued', 'done', 'failed')),
  processing_error  text,
  processed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, position)
);

-- Status events can point at the submission that caused them.
ALTER TABLE app.status_events ADD COLUMN submission_id uuid REFERENCES app.submissions (id);

-- Admin queue view: everything a reviewer needs on one row.
CREATE VIEW app.review_queue AS
SELECT s.id, s.status, s.kind, s.county, s.parcel_id, s.submitted_at, s.conditions, s.note,
       st.name AS submitted_by_name, s.review_reason,
       f.situs_address, f.owner_name, f.owner_type, f.ward, f.in_city,
       COALESCE(cur.status, 'unreported') AS parcel_status,
       (SELECT count(*) FROM app.photos p WHERE p.submission_id = s.id) AS photo_count,
       (SELECT round(max(ST_Distance(p.exif_pt::geography, f.pt::geography)))
          FROM app.photos p WHERE p.submission_id = s.id AND p.exif_pt IS NOT NULL) AS max_exif_distance_m,
       (SELECT count(*) FROM app.photos p WHERE p.submission_id = s.id AND p.exif_pt IS NULL) AS photos_without_gps,
       (SELECT count(*) FROM app.submissions o
         WHERE o.county = s.county AND o.parcel_id = s.parcel_id AND o.id <> s.id AND o.status <> 'draft') AS prior_submissions
FROM app.submissions s
JOIN app.staff st ON st.id = s.submitted_by
LEFT JOIN app.parcel_facts f ON f.county = s.county AND f.parcel_id = s.parcel_id
LEFT JOIN app.parcel_status_current cur ON cur.county = s.county AND cur.parcel_id = s.parcel_id;
