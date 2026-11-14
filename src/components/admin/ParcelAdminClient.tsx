"use client";

import { useState } from "react";
import { ACTION_OPTIONS, actionLabel, post, uploadDocument } from "./api";

interface Ev {
  id: number;
  status: string;
  substatus: string | null;
  effective_date: string;
  recorded_at: string;
  source: string;
  note: string | null;
  document_id: string | null;
  document_title: string | null;
  submission_id: string | null;
  recorded_by_name: string | null;
  void_reason: string | null;
  voided_by_name: string | null;
}

const STATUS: Record<string, string> = {
  unreported: "Unreported", submitted: "Submitted (not public)", verified_blighted: "Verified blighted",
  city_action: "City action", resolved: "Resolved",
};
const SOURCE: Record<string, string> = {
  user_photo: "Staff photo", admin_entry: "Newsroom entry", city_record: "City record", council_agenda: "Council agenda",
  survey: "Survey", land_roll: "Land roll",
};

export default function ParcelAdminClient({ parcel }: { parcel: { parcel_id: string; status: string; substatus: string | null; history: Ev[] } }) {
  const [choice, setChoice] = useState("verified_blighted");
  const [date, setDate] = useState("");
  const [source, setSource] = useState("city_record");
  const [note, setNote] = useState("");
  const [doc, setDoc] = useState<File | null>(null);
  const [docPublic, setDocPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const record = async () => {
    setBusy(true);
    setError(null);
    try {
      const documentId = doc ? await uploadDocument(doc, { public: docPublic, title: note || doc.name, date }) : null;
      const action = ACTION_OPTIONS.find((a) => a.substatus === choice);
      await post(`/api/admin/parcels/${encodeURIComponent(parcel.parcel_id)}/events`, {
        status: action ? (["demolished", "repaired", "lot_cleared"].includes(choice) ? "resolved" : "city_action") : "verified_blighted",
        substatus: action ? choice : null,
        date, source, note, documentId,
      });
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="review-grid">
      <section className="card">
        <h2>History (newest first)</h2>
        <table className="table">
          <thead><tr><th>Date</th><th>Status</th><th>Source</th><th>Recorded</th><th></th></tr></thead>
          <tbody>
            {parcel.history.map((e) => (
              <tr key={e.id} style={e.void_reason ? { textDecoration: "line-through", opacity: 0.55 } : undefined}>
                <td className="small">{e.effective_date}</td>
                <td>
                  {STATUS[e.status] ?? e.status}{e.substatus && ` · ${actionLabel(e.substatus)}`}
                  {e.note && <div className="muted small">{e.note}</div>}
                  {e.document_id && <div className="small"><a href={`/api/documents/${e.document_id}`} target="_blank" rel="noreferrer">{e.document_title ?? "Document"}</a></div>}
                  {e.void_reason && <div className="small" style={{ textDecoration: "none" }}>Voided by {e.voided_by_name}: {e.void_reason}</div>}
                </td>
                <td className="small">{SOURCE[e.source] ?? e.source}</td>
                <td className="small muted">{e.recorded_by_name}<br />{new Date(e.recorded_at).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}</td>
                <td>
                  {!e.void_reason && (
                    <button className="btn secondary" style={{ padding: "3px 8px", fontSize: 12 }} onClick={async () => {
                      const reason = prompt("Why is this entry being voided? (kept on record)");
                      if (!reason) return;
                      try {
                        await post(`/api/admin/events/${e.id}/void`, { reason });
                        window.location.reload();
                      } catch (err) {
                        alert((err as Error).message);
                      }
                    }}>Void</button>
                  )}
                </td>
              </tr>
            ))}
            {!parcel.history.length && <tr><td colSpan={5} className="muted">No history yet.</td></tr>}
          </tbody>
        </table>
      </section>
      <aside className="card stack">
        <h2>Record an update</h2>
        <select className="select" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="verified_blighted">Verified blighted (newsroom checked)</option>
          <optgroup label="City action">
            {ACTION_OPTIONS.slice(0, 6).map((a) => <option key={a.substatus} value={a.substatus}>{a.label}</option>)}
          </optgroup>
          <optgroup label="Resolved">
            {ACTION_OPTIONS.slice(6).map((a) => <option key={a.substatus} value={a.substatus}>{a.label}</option>)}
          </optgroup>
        </select>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">Date it happened</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="city_record">Source: city record</option>
          <option value="council_agenda">Source: council agenda</option>
          <option value="admin_entry">Source: newsroom (site visit, reporting)</option>
          <option value="land_roll">Source: land roll</option>
        </select>
        <textarea className="textarea" placeholder="Note (case number, what the record says)" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">Source document (optional)</span>
          <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} />
        </label>
        {doc && (
          <label className="check small"><input type="checkbox" checked={docPublic} onChange={(e) => setDocPublic(e.target.checked)} /> Public (linked from the parcel&apos;s history)</label>
        )}
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy || !date} onClick={record}>{busy ? "Saving…" : "Record"}</button>
        <p className="muted small" style={{ margin: 0 }}>History is never edited. To fix a mistake, void the entry and record the correct one.</p>
      </aside>
    </div>
  );
}
