"use client";

import { useState } from "react";

export default function PasswordForm({ next, forced }: { next: string; forced: boolean }) {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw !== again) return setError("The new passwords don't match.");
        setBusy(true);
        setError(null);
        const res = await fetch("/api/auth/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current, next: pw }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setError(body.error ?? "Couldn't change the password.");
        window.location.href = next;
      }}
    >
      {forced && <p style={{ margin: 0 }}>You signed in with a temporary password. Choose your own to continue.</p>}
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted">{forced ? "Temporary password" : "Current password"}</span>
        <input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted">New password (at least 10 characters)</span>
        <input className="input" type="password" autoComplete="new-password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted">New password again</span>
        <input className="input" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn block" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
    </form>
  );
}
