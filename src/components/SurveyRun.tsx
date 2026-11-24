"use client";

import { useCallback, useEffect, useState } from "react";

interface P {
  parcel_id: string;
  situs_address: string | null;
  owner_name: string | null;
  status: string;
  mark: "blighted" | "not_blighted" | "inaccessible" | null;
  last_surveyed_on: string | null;
  submission_open: boolean;
  distance_m: number | null;
  total: number;
}
interface Progress { total: number; marked: number; blighted: number; not_blighted: number; inaccessible: number }

const MARK: Record<string, string> = { blighted: "Blighted", not_blighted: "Not blighted", inaccessible: "Couldn't see it" };
const STATUS: Record<string, string> = {
  verified_blighted: "verified blighted", city_action: "city action", city_flagged: "City-flagged", resolved: "resolved",
};

export default function SurveyRun({ surveyId, finished }: { surveyId: string; finished: boolean }) {
  const [rows, setRows] = useState<P[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [todo, setTodo] = useState(true);
  const [near, setNear] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (todo) qs.set("todo", "1");
    if (near) { qs.set("lat", String(near.lat)); qs.set("lon", String(near.lon)); }
    const r = await fetch(`/api/surveys/${surveyId}/parcels?${qs}`);
    const b = await r.json();
    if (!r.ok) return setError(b.error ?? "Couldn't load parcels.");
    setRows(b.rows);
    setProgress(b.progress);
  }, [surveyId, todo, near]);

  useEffect(() => { void load(); }, [load]);

  const mark = async (p: P, result: "not_blighted" | "inaccessible") => {
    setBusy(p.parcel_id);
    setError(null);
    const r = await fetch(`/api/surveys/${surveyId}/marks`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parcelId: p.parcel_id, result }),
    });
    const b = await r.json();
    setBusy(null);
    if (!r.ok) return setError(b.error);
    void load();
  };

  const locate = () => {
    if (near) return setNear(null);
    navigator.geolocation?.getCurrentPosition(
      (pos) => setNear({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setError("Couldn't get your location."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const pct = progress ? Math.round((100 * progress.marked) / Math.max(1, progress.total)) : 0;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {progress && (
        <div className="card stack" style={{ gap: 6 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{progress.marked} of {progress.total} parcels marked ({pct}%)</strong>
            <span className="muted small">{progress.blighted} blighted · {progress.not_blighted} not · {progress.inaccessible} couldn&apos;t see</span>
          </div>
          <div className="bar" style={{ height: 10 }}><span style={{ width: `${pct}%`, background: "var(--resolved)" }} /></div>
        </div>
      )}
      {finished && <div className="card warn">This survey is finished. Start a new one to keep marking parcels.</div>}
      <div className="row">
        <div className="seg" role="group" style={{ flex: 1 }}>
          <button aria-pressed={todo} onClick={() => setTodo(true)}>Still to do</button>
          <button aria-pressed={!todo} onClick={() => setTodo(false)}>All parcels</button>
        </div>
        <button className="btn secondary" onClick={locate}>{near ? "Street order" : "Nearest first"}</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {rows.length === 0 && <div className="card muted">{todo ? "Every parcel is marked." : "No parcels."}</div>}
      {rows.map((p) => (
        <div key={p.parcel_id} className="card stack" style={{ gap: 8, padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <strong style={{ fontSize: 17 }}>{p.situs_address ?? p.parcel_id}</strong>
            {p.distance_m !== null && <span className="muted small">{p.distance_m} m</span>}
          </div>
          <div className="muted small">
            {p.parcel_id} · {p.owner_name ?? "Owner unknown"}
            {STATUS[p.status] && ` · ${STATUS[p.status]}`}
            {p.last_surveyed_on && ` · surveyed ${p.last_surveyed_on}`}
            {p.submission_open && " · photo in review"}
          </div>
          {p.mark && <div><span className={`pill ${p.mark === "blighted" ? "rejected" : p.mark === "not_blighted" ? "approved" : ""}`}>{MARK[p.mark]}</span></div>}
          {!finished && (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn ok" style={{ flex: 1 }} disabled={busy === p.parcel_id} onClick={() => mark(p, "not_blighted")}>Not blighted</button>
              <a className="btn danger" style={{ flex: 1 }} href={`/submit?parcel=${encodeURIComponent(p.parcel_id)}&survey=${surveyId}`}>Blighted: photo</a>
              <button className="btn secondary" style={{ flex: 1 }} disabled={busy === p.parcel_id} onClick={() => mark(p, "inaccessible")}>Can&apos;t see</button>
            </div>
          )}
        </div>
      ))}
      {!finished && progress && progress.marked > 0 && (
        <button className="btn secondary" onClick={async () => {
          if (!confirm("Finish this survey? Unmarked parcels stay unsurveyed.")) return;
          await fetch(`/api/surveys/${surveyId}/complete`, { method: "POST" });
          window.location.reload();
        }}>Finish survey</button>
      )}
    </div>
  );
}
