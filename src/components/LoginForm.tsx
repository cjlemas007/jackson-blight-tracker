"use client";

import { useState } from "react";

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setError(body.error ?? "Sign-in failed.");
        window.location.href = body.mustChangePassword ? `/account/password?next=${encodeURIComponent(next)}` : next;
      }}
    >
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted">Work email</span>
        <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted">Password</span>
        <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <p className="muted small" style={{ margin: 0 }}>Forgot your password? Ask an admin to reset it.</p>
    </form>
  );
}
