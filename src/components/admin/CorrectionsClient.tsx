"use client";

import Link from "next/link";
import { useState } from "react";
import { CORRECTION_CATEGORIES } from "@/lib/correctionCategories";
import { post } from "./api";

interface C {
  id: number;
  parcel_id: string | null;
  portfolio_id: string | null;
  situs_address: string | null;
  category: string;
  details: string;
  contact_name: string | null;
  contact_email: string | null;
  page_url: string | null;
  created_at: string;
  resolution: string | null;
  resolved_by_name: string | null;
}

export default function CorrectionsClient({ rows, open }: { rows: C[]; open: boolean }) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (!rows.length) return <div className="card muted">Nothing here.</div>;
  const act = async (id: number, status: string) => {
    setError(null);
    try {
      await post(`/api/admin/corrections/${id}`, { status, resolution: notes[id] ?? "" });
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      {error && <div className="error">{error}</div>}
      {rows.map((c) => (
        <div key={c.id} className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{CORRECTION_CATEGORIES.find((x) => x.id === c.category)?.label ?? c.category}</strong>
            <span className="muted small">{new Date(c.created_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          <div className="small">
            {c.parcel_id && <>Parcel: <Link href={`/admin/parcels/${encodeURIComponent(c.parcel_id)}`}>{c.situs_address ?? c.parcel_id}</Link></>}
            {c.portfolio_id && <>Owner: <Link href={`/owners/${encodeURIComponent(c.portfolio_id)}`}>{c.portfolio_id}</Link></>}
          </div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{c.details}</div>
          {(c.contact_name || c.contact_email) && (
            <div className="small muted">From: {c.contact_name ?? "(no name)"}{c.contact_email && <> · <a href={`mailto:${c.contact_email}`}>{c.contact_email}</a></>}</div>
          )}
          {open ? (
            <>
              <textarea className="textarea" placeholder="What was done (or why not). Internal." value={notes[c.id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} />
              <div className="row">
                <button className="btn ok" disabled={!notes[c.id]?.trim()} onClick={() => act(c.id, "corrected")}>Mark corrected</button>
                <button className="btn secondary" disabled={!notes[c.id]?.trim()} onClick={() => act(c.id, "declined")}>Decline</button>
              </div>
            </>
          ) : (
            <div className="small">{c.resolved_by_name}: {c.resolution}</div>
          )}
        </div>
      ))}
    </>
  );
}
