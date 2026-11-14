/** Public correction requests from parcel and owner pages, handled by admins. */
import { createHash } from "node:crypto";
import { getPool } from "./db";
import { audit, type Staff } from "./auth/staff";
import { WorkflowError } from "./submissions";

export { CORRECTION_CATEGORIES } from "./correctionCategories";
import { CORRECTION_CATEGORIES } from "./correctionCategories";

export const MAX_PER_HOUR = 5;

/** Salted, daily-rotating hash of the requester, used only for rate limiting (no IP is stored). */
export function submitterHash(ip: string, userAgent: string, day = new Date().toISOString().slice(0, 10)): string {
  const salt = process.env.CORRECTIONS_SALT ?? "jbt-corrections";
  return createHash("sha256").update(`${salt}|${day}|${ip}|${userAgent}`).digest("hex");
}

export interface CorrectionInput {
  parcelId?: string | null;
  portfolioId?: string | null;
  category: string;
  details: string;
  name?: string | null;
  email?: string | null;
  pageUrl?: string | null;
}

export async function submitCorrection(input: CorrectionInput, hash: string): Promise<number> {
  if (!CORRECTION_CATEGORIES.some((c) => c.id === input.category)) throw new WorkflowError("Pick what's wrong.");
  const details = (input.details ?? "").trim();
  if (details.length < 10) throw new WorkflowError("Tell us a bit more (at least 10 characters).");
  if (details.length > 2000) throw new WorkflowError("Keep it under 2,000 characters.");
  const email = (input.email ?? "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new WorkflowError("That email address doesn't look right.");
  if (!input.parcelId && !input.portfolioId) throw new WorkflowError("Missing the parcel or owner this is about.");
  const pool = getPool();
  const recent = await pool.query(
    "SELECT count(*)::int n FROM app.corrections WHERE submitter_hash = $1 AND created_at > now() - interval '1 hour'",
    [hash],
  );
  if (recent.rows[0].n >= MAX_PER_HOUR) throw new WorkflowError("Too many requests. Please try again later.", 429);
  if (input.parcelId) {
    const ok = await pool.query("SELECT 1 FROM app.parcel_registry WHERE county = 'Hinds' AND parcel_id = $1", [input.parcelId]);
    if (!ok.rows.length) throw new WorkflowError("Unknown parcel.", 404);
  }
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO app.corrections (county, parcel_id, portfolio_id, category, details, contact_name, contact_email, submitter_hash, page_url)
     VALUES (CASE WHEN $1::text IS NULL THEN NULL ELSE 'Hinds' END, $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.parcelId || null, input.portfolioId || null, input.category, details, input.name?.trim().slice(0, 120) || null,
     email.slice(0, 200) || null, hash, input.pageUrl?.slice(0, 500) || null],
  );
  return rows[0].id;
}

export async function listCorrections(status = "open") {
  const { rows } = await getPool().query(
    `SELECT c.*, f.situs_address, st.name AS resolved_by_name
     FROM app.corrections c
     LEFT JOIN app.parcel_facts f ON f.county = c.county AND f.parcel_id = c.parcel_id
     LEFT JOIN app.staff st ON st.id = c.resolved_by
     WHERE c.status = $1 ORDER BY c.created_at ${status === "open" ? "ASC" : "DESC"} LIMIT 200`,
    [status],
  );
  return rows;
}

export async function resolveCorrection(admin: Staff, id: number, status: "corrected" | "declined", resolution: string) {
  if (admin.role !== "admin") throw new WorkflowError("Admins only.", 403);
  if (!["corrected", "declined"].includes(status)) throw new WorkflowError("Pick corrected or declined.");
  if (!resolution?.trim()) throw new WorkflowError("Note what was done (or why not).");
  const pool = getPool();
  const r = await pool.query(
    "UPDATE app.corrections SET status = $2, resolved_by = $3, resolved_at = now(), resolution = $4 WHERE id = $1 AND status = 'open'",
    [id, status, admin.id, resolution.trim().slice(0, 1000)],
  );
  if (!r.rowCount) throw new WorkflowError("Already handled.");
  await audit(pool, admin.id, `correction.${status}`, "correction", String(id), {});
}
