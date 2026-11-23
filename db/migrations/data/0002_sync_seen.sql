-- DATA LAYER: which parcels a sync run has seen.
--
-- The land-roll and tax jobs used to stamp last_seen_at / synced_at on every row every night so they
-- could retire rows that dropped off upstream. That rewrote ~110,000 unchanged rows per table per
-- night, roughly doubling the tables on disk (Postgres keeps the old row versions), which pushed
-- the free Supabase database (500 MB cap) over its limit. Runs now record what they saw here and
-- only write rows that actually changed. Rows are deleted when the job finishes; a run that dies
-- resumes with the same run_id, so its earlier pages still count.

CREATE UNLOGGED TABLE data.sync_seen (
  run_id     uuid NOT NULL,
  county     text NOT NULL,
  parcel_id  text NOT NULL,
  PRIMARY KEY (run_id, county, parcel_id)
);
