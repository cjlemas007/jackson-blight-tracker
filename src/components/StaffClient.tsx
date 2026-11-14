"use client";

import { useState } from "react";

interface Row {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? "That didn't work.");
  return out;
}

export default function StaffClient({ me, initial }: { me: string; initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [form, setForm] = useState({ email: "", name: "", role: "contributor" });
  const [secret, setSecret] = useState<{ who: string; pw: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => window.location.reload();

  return (
    <>
      {secret && (
        <div className="card warn stack">
          <div>
            Temporary password for <strong>{secret.who}</strong> (shown once; they&apos;ll set their own at first sign-in):
          </div>
          <span className="secret">{secret.pw}</span>
          <button className="btn secondary" style={{ alignSelf: "flex-start" }} onClick={() => setSecret(null)}>Done</button>
        </div>
      )}

      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const out = await post("/api/admin/staff", form);
            setSecret({ who: out.staff.email, pw: out.temporaryPassword });
            setRows((r) => [...r, { ...out.staff, active: true, last_login_at: null }]);
            setForm({ email: "", name: "", role: "contributor" });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <h2>Add a coworker</h2>
        <div className="row">
          <input className="input" style={{ flex: "1 1 200px" }} placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" style={{ flex: "1 1 220px" }} type="email" placeholder="Work email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select className="select" style={{ flex: "0 0 150px" }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="contributor">Contributor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn" style={{ alignSelf: "flex-start" }}>Create account</button>
      </form>

      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Role</th><th>Last sign-in</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={r.active ? undefined : { opacity: 0.5 }}>
                <td>
                  <strong>{r.name}</strong>
                  <div className="muted small">{r.email}{r.must_change_password && " · temporary password"}</div>
                </td>
                <td>
                  <select
                    className="select"
                    value={r.role}
                    disabled={r.id === me}
                    onChange={async (e) => {
                      try {
                        await post(`/api/admin/staff/${r.id}`, { action: "update", role: e.target.value, active: r.active });
                        setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, role: e.target.value } : x)));
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}
                  >
                    <option value="contributor">Contributor</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="small">
                  {r.last_login_at ? new Date(r.last_login_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) : "Never"}
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="btn secondary"
                      onClick={async () => {
                        if (!confirm(`Reset ${r.name}'s password? They'll be signed out everywhere.`)) return;
                        try {
                          const out = await post(`/api/admin/staff/${r.id}`, { action: "reset" });
                          setSecret({ who: r.email, pw: out.temporaryPassword });
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    >
                      Reset password
                    </button>
                    {r.id !== me && (
                      <button
                        className="btn secondary"
                        onClick={async () => {
                          try {
                            await post(`/api/admin/staff/${r.id}`, { action: "update", role: r.role, active: !r.active });
                            reload();
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }}
                      >
                        {r.active ? "Deactivate" : "Reactivate"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
