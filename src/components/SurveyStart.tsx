"use client";

import { useEffect, useState } from "react";

interface Street { street_name: string; parcels: number; surveyed: number }

async function start(kind: string, value: string) {
  const res = await fetch("/api/surveys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, value }) });
  const b = await res.json();
  if (!res.ok) throw new Error(b.error ?? "Couldn't start the survey.");
  window.location.href = `/survey/${b.id}`;
}

export default function SurveyStart({ areas }: { areas: { kind: string; code: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [streets, setStreets] = useState<Street[]>([]);
  const [area, setArea] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setStreets([]);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/surveys/streets?q=${encodeURIComponent(q)}`);
      setStreets(r.ok ? await r.json() : []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const go = (kind: string, value: string) => start(kind, value).catch((e) => setError(e.message));
  return (
    <>
      <section className="card stack">
        <h2>Survey a street (recommended)</h2>
        <input className="input" placeholder="Street name, e.g. Robinson" value={q} onChange={(e) => setQ(e.target.value)} />
        {streets.length > 0 && (
          <ul className="results">
            {streets.map((s) => (
              <li key={s.street_name}>
                <button type="button" onClick={() => go("street", s.street_name)}>
                  <strong>{s.street_name}</strong>
                  <span className="muted"> · {s.parcels} parcels · {Math.round((100 * s.surveyed) / Math.max(1, s.parcels))}% surveyed</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card stack">
        <h2>Or an area</h2>
        <div className="row">
          <select className="select" style={{ flex: 1 }} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Pick a ward, neighborhood or tract</option>
            {["ward", "neighborhood", "tract"].map((k) => (
              <optgroup key={k} label={k === "ward" ? "Wards" : k === "neighborhood" ? "Neighborhoods (unofficial)" : "Census tracts"}>
                {areas.filter((a) => a.kind === k).map((a) => <option key={`${k}:${a.code}`} value={`${k}:${a.code}`}>{a.name}</option>)}
              </optgroup>
            ))}
          </select>
          <button className="btn" disabled={!area} onClick={() => { const [k, ...c] = area.split(":"); go(k, c.join(":")); }}>Start</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Areas can hold thousands of parcels. Use &ldquo;nearest first&rdquo; once you&apos;re there.</p>
      </section>
      {error && <div className="error">{error}</div>}
    </>
  );
}
