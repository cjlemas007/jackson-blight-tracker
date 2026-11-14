import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshTestDb } from "./helpers/testdb";
import { hashPassword, passwordProblem, temporaryPassword, verifyPassword } from "@/lib/auth/password";
import { changePassword, createStaff, login, logout, resetPassword, setRoleAndActive, staffForToken } from "@/lib/auth/staff";
import { getPool } from "@/lib/db";

let pool: pg.Pool;
beforeAll(async () => {
  pool = await freshTestDb();
});
afterAll(async () => {
  await pool.end();
  await getPool().end();
});

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterY", a)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
  });
  it("rejects short passwords and makes readable temporary ones", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/easy/);
    expect(passwordProblem("a decent passphrase")).toBeNull();
    expect(temporaryPassword()).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
});

describe("accounts and sessions", () => {
  it("signs in with the temporary password, then forces a change", async () => {
    const { staff, temporaryPassword: pw } = await createStaff({ email: "Reporter@WLBT.test", name: "Pat Reporter", role: "contributor" }, null);
    expect(staff.must_change_password).toBe(true);
    const r = await login("reporter@wlbt.test", pw); // email is case-insensitive
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await staffForToken(r.token))?.must_change_password).toBe(true);
    expect(await changePassword(staff.id, pw, pw)).toMatch(/different/);
    expect(await changePassword(staff.id, "wrong-wrong-wrong", "a new long passphrase")).toMatch(/current password is wrong/);
    expect(await changePassword(staff.id, pw, "a new long passphrase")).toBeNull();
    expect((await staffForToken(r.token))?.must_change_password).toBe(false);
    expect((await login("reporter@wlbt.test", "a new long passphrase")).ok).toBe(true);
  });

  it("gives the same error for unknown emails and wrong passwords", async () => {
    const a = await login("nobody@wlbt.test", "whatever-123");
    const b = await login("reporter@wlbt.test", "whatever-123");
    expect(a).toEqual({ ok: false, error: "Email or password is wrong." });
    expect(b).toEqual(a);
  });

  it("locks an email out after 5 failures in 15 minutes", async () => {
    await createStaff({ email: "locked@wlbt.test", name: "L", role: "contributor" }, null);
    for (let i = 0; i < 5; i++) await login("locked@wlbt.test", "nope-nope-nope");
    const r = await login("locked@wlbt.test", "nope-nope-nope");
    expect(r.ok ? "" : r.error).toMatch(/Too many failed attempts/);
  });

  it("stores only a hash of the session token, and logout ends it", async () => {
    const { temporaryPassword: pw } = await createStaff({ email: "s@wlbt.test", name: "S", role: "admin" }, null);
    const r = await login("s@wlbt.test", pw);
    if (!r.ok) throw new Error("login failed");
    const { rows } = await pool.query("SELECT token_hash FROM app.sessions WHERE token_hash = $1", [r.token]);
    expect(rows).toEqual([]); // raw token never stored
    expect(await staffForToken(r.token)).not.toBeNull();
    await logout(r.token);
    expect(await staffForToken(r.token)).toBeNull();
  });

  it("an admin reset or deactivation signs the person out everywhere", async () => {
    const { staff, temporaryPassword: pw } = await createStaff({ email: "x@wlbt.test", name: "X", role: "contributor" }, null);
    const r1 = await login("x@wlbt.test", pw);
    if (!r1.ok) throw new Error("login failed");
    const newPw = await resetPassword(staff.id, null);
    expect(await staffForToken(r1.token)).toBeNull();
    expect((await login("x@wlbt.test", pw)).ok).toBe(false);
    const r2 = await login("x@wlbt.test", newPw);
    if (!r2.ok) throw new Error("login failed");
    const { rows: admins } = await pool.query("SELECT id FROM app.staff WHERE role = 'admin' LIMIT 1");
    await setRoleAndActive(staff.id, "contributor", false, admins[0].id);
    expect(await staffForToken(r2.token)).toBeNull();
    expect((await login("x@wlbt.test", newPw)).ok).toBe(false);
  });

  it("writes an audit trail", async () => {
    const { rows } = await pool.query("SELECT action FROM app.audit_log ORDER BY id");
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["staff.create", "staff.change_password", "staff.reset_password", "staff.update"]),
    );
  });
});
