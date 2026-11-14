/**
 * Staff accounts from the command line (bootstraps the first admin).
 *   npm run staff -- add <email> "<name>" <admin|contributor>
 *   npm run staff -- reset <email>
 *   npm run staff -- list
 *   npm run staff -- dev-accounts      (local only; password from DEV_STAFF_PASSWORD)
 * Temporary passwords print once; the person changes theirs on first sign-in.
 */
import { loadEnv } from "../sync/env";
loadEnv();
const { getPool } = await import("../src/lib/db");
const { createStaff, resetPassword } = await import("../src/lib/auth/staff");

const [cmd, ...args] = process.argv.slice(2);
const pool = getPool();
try {
  if (cmd === "add") {
    const [email, name, role = "contributor"] = args;
    if (!email || !name || !["admin", "contributor"].includes(role)) throw new Error('usage: add <email> "<name>" <admin|contributor>');
    const { staff, temporaryPassword } = await createStaff({ email, name, role: role as "admin" | "contributor" }, null);
    console.log(`created ${staff.role} ${staff.email}\ntemporary password: ${temporaryPassword}`);
  } else if (cmd === "reset") {
    const { rows } = await pool.query("SELECT id FROM app.staff WHERE email = $1", [args[0]]);
    if (!rows[0]) throw new Error(`no staff account for ${args[0]}`);
    console.log(`temporary password: ${await resetPassword(rows[0].id, null)}`);
  } else if (cmd === "dev-accounts") {
    // Local development only: two known accounts using DEV_STAFF_PASSWORD from .env.local.
    if (process.env.NODE_ENV === "production" || process.env.SUPABASE_URL) throw new Error("dev-accounts is for local development only");
    const pw = process.env.DEV_STAFF_PASSWORD;
    if (!pw || pw.length < 10) throw new Error("set DEV_STAFF_PASSWORD (10+ chars) in .env.local");
    const { hashPassword } = await import("../src/lib/auth/password");
    for (const [email, name, role] of [
      ["dev-admin@example.test", "Dev Admin", "admin"],
      ["dev-contributor@example.test", "Dev Contributor", "contributor"],
    ]) {
      await pool.query(
        `INSERT INTO app.staff (email, name, role, password_hash, must_change_password) VALUES ($1, $2, $3, $4, false)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = false, active = true`,
        [email, name, role, await hashPassword(pw)],
      );
      console.log(`ready: ${email} (${role})`);
    }
  } else if (cmd === "list") {
    const { rows } = await pool.query("SELECT email, name, role, active, last_login_at FROM app.staff ORDER BY email");
    console.table(rows);
  } else {
    throw new Error("commands: add, reset, list");
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
