import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { getPool } from "../db";
import { hashPassword, passwordProblem, temporaryPassword, verifyPassword } from "./password";

export type Role = "contributor" | "admin";

export interface Staff {
  id: string;
  email: string;
  name: string;
  role: Role;
  must_change_password: boolean;
}

export const SESSION_DAYS = 14;
const MAX_FAILURES = 5;
const FAILURE_WINDOW = "15 minutes";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function audit(
  db: pg.Pool | pg.PoolClient,
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string,
  details: Record<string, unknown> = {},
) {
  await db.query(
    "INSERT INTO app.audit_log (actor_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)",
    [actorId, action, entity, entityId, details],
  );
}

/** Create an account with a temporary password the person must change on first sign-in. */
export async function createStaff(
  input: { email: string; name: string; role: Role },
  createdBy: string | null,
): Promise<{ staff: Staff; temporaryPassword: string }> {
  const pw = temporaryPassword();
  const { rows } = await getPool().query<Staff>(
    `INSERT INTO app.staff (email, name, role, password_hash, must_change_password, created_by)
     VALUES ($1, $2, $3, $4, true, $5)
     RETURNING id, email, name, role, must_change_password`,
    [input.email.trim(), input.name.trim(), input.role, await hashPassword(pw), createdBy],
  );
  await audit(getPool(), createdBy, "staff.create", "staff", rows[0].id, { email: rows[0].email, role: input.role });
  return { staff: rows[0], temporaryPassword: pw };
}

/** Admin-initiated reset (no email): new temporary password, all sessions signed out. */
export async function resetPassword(staffId: string, by: string | null): Promise<string> {
  const pw = temporaryPassword();
  const pool = getPool();
  await pool.query("UPDATE app.staff SET password_hash = $2, must_change_password = true WHERE id = $1", [
    staffId,
    await hashPassword(pw),
  ]);
  await pool.query("DELETE FROM app.sessions WHERE staff_id = $1", [staffId]);
  await audit(pool, by, "staff.reset_password", "staff", staffId);
  return pw;
}

export async function setRoleAndActive(staffId: string, role: Role, active: boolean, by: string) {
  const pool = getPool();
  await pool.query("UPDATE app.staff SET role = $2, active = $3 WHERE id = $1", [staffId, role, active]);
  if (!active) await pool.query("DELETE FROM app.sessions WHERE staff_id = $1", [staffId]);
  await audit(pool, by, "staff.update", "staff", staffId, { role, active });
}

export async function changePassword(staffId: string, current: string, next: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ password_hash: string }>("SELECT password_hash FROM app.staff WHERE id = $1", [
    staffId,
  ]);
  if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) return "Your current password is wrong.";
  const problem = passwordProblem(next);
  if (problem) return problem;
  if (current === next) return "Choose a password different from the temporary one.";
  await pool.query("UPDATE app.staff SET password_hash = $2, must_change_password = false WHERE id = $1", [
    staffId,
    await hashPassword(next),
  ]);
  await audit(pool, staffId, "staff.change_password", "staff", staffId);
  return null;
}

export type LoginResult = { ok: true; token: string; staff: Staff } | { ok: false; error: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  const pool = getPool();
  const e = email.trim();
  const failures = Number(
    (
      await pool.query(
        `SELECT count(*) n FROM app.login_attempts WHERE email = $1 AND NOT ok AND attempted_at > now() - interval '${FAILURE_WINDOW}'`,
        [e],
      )
    ).rows[0].n,
  );
  if (failures >= MAX_FAILURES) return { ok: false, error: "Too many failed attempts. Try again in 15 minutes." };

  const { rows } = await pool.query<Staff & { password_hash: string; active: boolean }>(
    "SELECT id, email, name, role, must_change_password, password_hash, active FROM app.staff WHERE email = $1",
    [e],
  );
  const s = rows[0];
  // Verify even when the account doesn't exist so timing doesn't reveal which emails are staff.
  const ok = s
    ? await verifyPassword(password, s.password_hash)
    : (await verifyPassword(password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86)), false);
  await pool.query("INSERT INTO app.login_attempts (email, ok) VALUES ($1, $2)", [e, ok && !!s?.active]);
  if (!s || !ok || !s.active) return { ok: false, error: "Email or password is wrong." };

  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO app.sessions (token_hash, staff_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [sha256(token), s.id],
  );
  await pool.query("UPDATE app.staff SET last_login_at = now() WHERE id = $1", [s.id]);
  const { password_hash: _h, active: _a, ...staff } = s;
  return { ok: true, token, staff };
}

export async function staffForToken(token: string | undefined): Promise<Staff | null> {
  if (!token) return null;
  const { rows } = await getPool().query<Staff>(
    `UPDATE app.sessions se SET last_seen_at = now()
     FROM app.staff st
     WHERE se.token_hash = $1 AND se.expires_at > now() AND st.id = se.staff_id AND st.active
     RETURNING st.id, st.email, st.name, st.role, st.must_change_password`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function logout(token: string | undefined) {
  if (token) await getPool().query("DELETE FROM app.sessions WHERE token_hash = $1", [sha256(token)]);
}
