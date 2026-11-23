-- LOGIC LAYER: code-enforcement case numbers.
--
-- Council resolutions declaring property a menace (Miss. Code 21-19-11) often list only the City's
-- code-enforcement case numbers ("25-2751"), not addresses. Agenda rows that carry only a case number
-- wait ('waiting_case') until a case log that links that case to a parcel is imported. Every applied
-- row that has both a case number and a parcel teaches app.code_cases the link.

CREATE TABLE app.code_cases (
  case_no          text PRIMARY KEY,            -- normalized: "25-2751" (two-digit year, number without leading zeros)
  county           text NOT NULL DEFAULT 'Hinds',
  parcel_id        text NOT NULL,
  address          text,
  source_batch_id  uuid REFERENCES app.import_batches (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (county, parcel_id) REFERENCES app.parcel_registry (county, parcel_id)
);
CREATE INDEX ON app.code_cases (county, parcel_id);

ALTER TABLE app.import_rows
  ADD COLUMN input_case_no text,
  ADD COLUMN agenda_item text;                  -- "3" for agenda item 3, when read from an agenda PDF

ALTER TABLE app.import_rows DROP CONSTRAINT import_rows_decision_check;
ALTER TABLE app.import_rows ADD CONSTRAINT import_rows_decision_check
  CHECK (decision IN ('pending', 'accepted', 'skipped', 'waiting_case'));

ALTER TABLE app.import_rows DROP CONSTRAINT import_rows_match_method_check;
ALTER TABLE app.import_rows ADD CONSTRAINT import_rows_match_method_check
  CHECK (match_method IN ('parcel_id', 'dpin', 'address_exact', 'address_fuzzy', 'manual', 'case_no'));

CREATE INDEX import_rows_waiting_case ON app.import_rows (input_case_no) WHERE decision = 'waiting_case';
