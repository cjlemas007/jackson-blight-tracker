/**
 * Survey mode: staff walk or drive a street (or area) and mark every parcel blighted (with a
 * photo submission), not blighted, or inaccessible. Marks are what make a coverage % real.
 */
import { getPool } from "./db";
import { audit, type Staff } from "./auth/staff";
import { WorkflowError } from "./submissions";
import { SURVEY_VALID_DAYS } from "@/config";

export type ScopeKind = "street" | "ward" | "neighborhood" | "tract";
export type SurveyResult = "blighted" | "not_blighted" | "inaccessible";
const today = "(now() AT TIME ZONE 'America/Chicago')::date";
export const BIG_SCOPE = 400; // parcels; above this the UI suggests a street instead

// Column for each scope kind. Interpolated into SQL, so only these four values are allowed.
const COLUMN: Record<ScopeKind, string> = { street: "street_name", ward: "ward", neighborhood: "neighborhood", tract: "tract" };
const col = (k: ScopeKind) => {
  if (!COLUMN[k]) throw new WorkflowError("Pick a street or an area.");
  return COLUMN[k];
};

export async function startSurvey(staff: Staff, input: { kind: ScopeKind; value: string }): Promise<string> {
  const value = (input.value ?? "").trim();
  const c = col(input.kind);
  const pool = getPool();
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM app.parcel_facts WHERE in_city AND ${c} = $1`, [value]);
  if (!rows[0].n) throw new WorkflowError(input.kind === "street" ? "No Jackson parcels on that street." : "No Jackson parcels in that area.");
  let label = value;
  if (input.kind !== "street") {
    const b = await pool.query<{ name: string }>("SELECT name FROM data.boundaries WHERE kind = $1 AND code = $2", [input.kind, value]);
    label = b.rows[0]?.name ?? value;
  }
  const { rows: s } = await pool.query<{ id: string }>(
    "INSERT INTO app.surveys (scope_kind, scope_value, scope_label, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
    [input.kind, value, label, staff.id],
  );
  await audit(pool, staff.id, "survey.start", "survey", s[0].id, { kind: input.kind, value, parcels: rows[0].n });
  return s[0].id;
}

export async function getSurvey(id: string) {
  const { rows } = await getPool().query(
    `SELECT s.*, st.name AS created_by_name FROM app.surveys s JOIN app.staff st ON st.id = s.created_by WHERE s.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Parcels in the survey's scope with this survey's mark (if any) and their current status.
 * Order: nearest first when a location is given, else by street and house number (odd side, then even).
 */
export async function surveyParcels(
  surveyId: string,
  opts: { near?: { lat: number; lon: number } | null; todoOnly?: boolean; limit?: number; offset?: number } = {},
) {
  const s = await getSurvey(surveyId);
  if (!s) throw new WorkflowError("Survey not found.", 404);
  const c = col(s.scope_kind);
  const near = opts.near ?? null;
  const { rows } = await getPool().query(
    `WITH marks AS (
       SELECT DISTINCT ON (parcel_id) parcel_id, result, recorded_at, submission_id
       FROM app.parcel_surveys WHERE survey_id = $1 ORDER BY parcel_id, recorded_at DESC, id DESC
     )
     SELECT p.parcel_id, p.situs_address, p.situs_number, p.street_name, p.owner_name,
            CASE WHEN p.status = 'submitted' THEN 'unreported'
                 WHEN p.status = 'city_action' AND NOT p.ever_verified AND p.council_found_on IS NULL THEN 'city_flagged' ELSE p.status::text END AS status,
            m.result AS mark, m.recorded_at AS marked_at,
            (SELECT max(surveyed_on)::text FROM app.parcel_surveys ps WHERE ps.county = p.county AND ps.parcel_id = p.parcel_id
               AND ps.surveyed_on > ${today} - $5::int) AS last_surveyed_on,
            EXISTS (SELECT 1 FROM app.submissions sb WHERE sb.county = p.county AND sb.parcel_id = p.parcel_id
                    AND sb.status IN ('processing', 'pending', 'needs_photo')) AS submission_open,
            ST_Y(p.pt) AS lat, ST_X(p.pt) AS lon,
            CASE WHEN $3::float8 IS NULL THEN NULL
                 ELSE round(ST_Distance(p.pt::geography, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography))::int END AS distance_m,
            count(*) OVER ()::int AS total
     FROM app.parcels p LEFT JOIN marks m USING (parcel_id)
     WHERE p.in_city AND p.${c} = $2 AND ($6::boolean IS NOT TRUE OR m.parcel_id IS NULL)
     ORDER BY
       CASE WHEN $3::float8 IS NULL THEN NULL ELSE p.pt <-> ST_SetSRID(ST_MakePoint($4, $3), 4326) END,
       p.street_name, (COALESCE(p.situs_number, 0) % 2) DESC, p.situs_number NULLS LAST, p.parcel_id
     LIMIT $7 OFFSET $8`,
    [surveyId, s.scope_value, near?.lat ?? null, near?.lon ?? null, SURVEY_VALID_DAYS, opts.todoOnly ?? false, opts.limit ?? 100, opts.offset ?? 0],
  );
  return rows;
}

export async function surveyProgress(surveyId: string) {
  const s = await getSurvey(surveyId);
  if (!s) throw new WorkflowError("Survey not found.", 404);
  const c = col(s.scope_kind);
  const { rows } = await getPool().query(
    `WITH marks AS (
       SELECT DISTINCT ON (parcel_id) parcel_id, result FROM app.parcel_surveys WHERE survey_id = $1
       ORDER BY parcel_id, recorded_at DESC, id DESC
     )
     SELECT count(*)::int AS total,
            count(m.parcel_id)::int AS marked,
            count(*) FILTER (WHERE m.result = 'blighted')::int AS blighted,
            count(*) FILTER (WHERE m.result = 'not_blighted')::int AS not_blighted,
            count(*) FILTER (WHERE m.result = 'inaccessible')::int AS inaccessible
     FROM app.parcel_facts f LEFT JOIN marks m USING (parcel_id)
     WHERE f.in_city AND f.${c} = $2`,
    [surveyId, s.scope_value],
  );
  return rows[0] as { total: number; marked: number; blighted: number; not_blighted: number; inaccessible: number };
}

/** Record one parcel's result. "blighted" needs the photo submission that backs it up. */
export async function markParcel(
  staff: Staff,
  surveyId: string,
  input: { parcelId: string; result: SurveyResult; submissionId?: string | null; note?: string | null },
) {
  if (!["blighted", "not_blighted", "inaccessible"].includes(input.result)) throw new WorkflowError("Unknown result.");
  const s = await getSurvey(surveyId);
  if (!s) throw new WorkflowError("Survey not found.", 404);
  if (s.completed_at) throw new WorkflowError("This survey is finished. Start a new one to keep going.");
  const c = col(s.scope_kind);
  const pool = getPool();
  const inScope = await pool.query(`SELECT 1 FROM app.parcel_facts WHERE in_city AND parcel_id = $1 AND ${c} = $2`, [input.parcelId, s.scope_value]);
  if (!inScope.rows.length) throw new WorkflowError("That parcel isn't part of this survey.");
  if (input.result === "blighted") {
    if (!input.submissionId) throw new WorkflowError("Marking a parcel blighted needs a photo submission.");
    const sub = await pool.query(
      "SELECT 1 FROM app.submissions WHERE id = $1 AND parcel_id = $2 AND submitted_by = $3 AND status <> 'draft'",
      [input.submissionId, input.parcelId, staff.id],
    );
    if (!sub.rows.length) throw new WorkflowError("That photo submission doesn't match this parcel.");
  }
  await pool.query(
    `INSERT INTO app.parcel_surveys (county, parcel_id, surveyed_on, result, surveyed_by, submission_id, note, survey_id)
     VALUES ('Hinds', $1, ${today}, $2, $3, $4, $5, $6)`,
    [input.parcelId, input.result, staff.id, input.submissionId ?? null, input.note?.slice(0, 300) || null, surveyId],
  );
}

export async function completeSurvey(staff: Staff, surveyId: string) {
  const pool = getPool();
  const r = await pool.query("UPDATE app.surveys SET completed_at = now() WHERE id = $1 AND completed_at IS NULL", [surveyId]);
  if (!r.rowCount) throw new WorkflowError("Already finished.");
  await audit(pool, staff.id, "survey.complete", "survey", surveyId, await surveyProgress(surveyId));
}

export async function recentSurveys(limit = 30) {
  const { rows } = await getPool().query(
    `SELECT s.id, s.scope_kind, s.scope_label, s.started_at, s.completed_at, st.name AS created_by_name,
            (SELECT count(DISTINCT parcel_id)::int FROM app.parcel_surveys ps WHERE ps.survey_id = s.id) AS marked
     FROM app.surveys s JOIN app.staff st ON st.id = s.created_by ORDER BY s.started_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Streets for the picker: every Jackson street with its parcel count and current coverage. */
export async function streetsForSurvey(q: string) {
  const { rows } = await getPool().query(
    `SELECT street_name, count(*)::int AS parcels, count(*) FILTER (WHERE surveyed)::int AS surveyed
     FROM app.ranking_base(${today}, $2) WHERE street_name LIKE '%' || upper($1) || '%'
     GROUP BY 1 ORDER BY (street_name LIKE upper($1) || '%') DESC, street_name LIMIT 20`,
    [q.trim(), SURVEY_VALID_DAYS],
  );
  return rows;
}
