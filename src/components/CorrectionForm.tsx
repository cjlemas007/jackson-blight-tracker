"use client";

import { useState } from "react";
import { CORRECTION_CATEGORIES } from "@/lib/correctionCategories";

/** "Request a correction" on parcel and owner pages. Contact details are optional and stay private. */
export default function CorrectionForm({ parcelId, portfolioId }: { parcelId?: string; portfolioId?: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "sent") return <div className="empty">Thanks. A newsroom editor will review your request.</div>;
  if (!open) {
    return (
      <button type="button" className="linkbtn small" onClick={() => setOpen(true)}>
        See something wrong? Request a correction
      </button>
    );
  }
  return (
    <form
      className="stack"
      style={{ gap: 8 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setState("sending");
        setError(null);
        const res = await fetch("/api/corrections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parcelId, portfolioId, category, details, name, email, website, pageUrl: window.location.href }),
        });
        const b = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(b.error ?? "Couldn't send that.");
          return setState("idle");
        }
        setState("sent");
      }}
    >
      <select className="select" required value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">What&apos;s wrong?</option>
        {CORRECTION_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <textarea className="textarea" required minLength={10} maxLength={2000} placeholder="Tell us what's wrong and how you know"
        value={details} onChange={(e) => setDetails(e.target.value)} />
      <input className="input" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" type="email" placeholder="Email, if you'd like a reply (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input aria-hidden tabIndex={-1} autoComplete="off" style={{ position: "absolute", left: -9999 }} value={website} onChange={(e) => setWebsite(e.target.value)} />
      <p className="flag" style={{ margin: 0 }}>Your name and email are seen only by newsroom editors.</p>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send"}</button>
        <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
