"use client";

import Link from "next/link";
import { useState } from "react";
import { post } from "./api";

interface S {
  id: number;
  kind: "ownership_transfer" | "improvement_zeroed";
  details: { old: string | null; new: string | null };
  detected_at: string;
  parcel_id: string;
  situs_address: string | null;
  owner_name: string | null;
  status: string;
}

export default function SuggestionsClient({ rows }: { rows: S[] }) {
  const [dates, setDates] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (!rows.length) return <div className="card muted">Nothing to review.</div>;
  const act = async (id: number, body: Record<string, unknown>) => {
    setError(null);
    try {
      await post(`/api/admin/suggestions/${id}`, body);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      {error && <div className="error">{error}</div>}
      {rows.map((s) => (
        <div key={s.id} className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Link href={`/admin/parcels/${encodeURIComponent(s.parcel_id)}`}><strong>{s.situs_address ?? s.parcel_id}</strong></Link>
            <span className="muted small">found {new Date(s.detected_at).toLocaleDateString("en-US", { timeZone: "America/Chicago" })}</span>
          </div>
          <div style={{ fontSize: 14 }}>
            {s.kind === "ownership_transfer"
              ? <>Owner changed: <strong>{s.details.old}</strong> → <strong>{s.details.new}</strong></>
              : <>Improvement value dropped from <strong>${Number(s.details.old).toLocaleString()}</strong> to <strong>$0</strong>. The building may be gone.</>}
          </div>
          <div className="row">
            {s.kind === "improvement_zeroed" && (
              <>
                <input className="input" type="date" style={{ maxWidth: 170, fontSize: 14, padding: "6px 8px" }}
                  value={dates[s.id] ?? ""} onChange={(e) => setDates({ ...dates, [s.id]: e.target.value })} />
                <button className="btn" disabled={!dates[s.id]} onClick={() => act(s.id, { action: "record", status: "resolved", substatus: "demolished", date: dates[s.id] })}>
                  Record as demolished
                </button>
              </>
            )}
            <Link className="btn secondary" href={`/admin/parcels/${encodeURIComponent(s.parcel_id)}`}>Open parcel</Link>
            <button className="btn secondary" onClick={() => act(s.id, { action: "dismiss" })}>Dismiss</button>
          </div>
        </div>
      ))}
    </>
  );
}
