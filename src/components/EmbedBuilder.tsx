"use client";

import { useEffect, useMemo, useState } from "react";

const COUNTERS = [
  { id: "blighted", label: "Blighted parcels" }, { id: "demolished_week", label: "Demolished this week" },
  { id: "state_owned", label: "State-owned blighted" }, { id: "share", label: "Share of parcels blighted" },
  { id: "resolved", label: "Resolved to date" }, { id: "city_flagged", label: "City-flagged" },
];
const STATUSES = [
  { id: "verified_blighted", label: "Verified blighted" }, { id: "city_action", label: "City action pending" },
  { id: "city_flagged", label: "City-flagged" }, { id: "resolved", label: "Resolved" },
];

export default function EmbedBuilder({ wards }: { wards: { code: string; name: string }[] }) {
  const [type, setType] = useState<"counters" | "chart" | "map">("counters");
  const [items, setItems] = useState(["blighted", "demolished_week", "state_owned", "resolved"]);
  const [chart, setChart] = useState("areas:ward");
  const [ward, setWard] = useState("");
  const [statuses, setStatuses] = useState(["verified_blighted", "city_action", "resolved"]);
  const [parcel, setParcel] = useState("");
  const [title, setTitle] = useState("");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const { path, height } = useMemo(() => {
    const qs = new URLSearchParams();
    if (title) qs.set("title", title);
    if (type === "counters") {
      qs.set("items", items.join(","));
      return { path: `/embed/counters?${qs}`, height: 160 };
    }
    if (type === "chart") {
      const [t, kind] = chart.split(":");
      qs.set("type", t);
      if (kind) qs.set("kind", kind);
      return { path: `/embed/chart?${qs}`, height: t === "trend" ? 330 : t === "stages" ? 290 : 420 };
    }
    if (ward) qs.set("ward", ward);
    qs.set("status", statuses.join(","));
    if (parcel.trim()) qs.set("parcel", parcel.trim());
    qs.delete("title");
    return { path: `/embed/map?${qs}`, height: 480 };
  }, [type, items, chart, ward, statuses, parcel, title]);

  const snippet = `<iframe src="${origin}${path}" title="${title || "Jackson Blight Tracker"}" width="100%" height="${height}" style="border:0" loading="lazy"></iframe>`;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="review-grid">
      <section className="card stack">
        <div className="seg" role="group">
          {(["counters", "chart", "map"] as const).map((t) => (
            <button key={t} aria-pressed={type === t} onClick={() => setType(t)}>{t === "counters" ? "Counters" : t === "chart" ? "Chart" : "Map"}</button>
          ))}
        </div>
        {type !== "map" && <input className="input" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />}
        {type === "counters" && (
          <div className="checks">
            {COUNTERS.map((c) => (
              <label key={c.id} className="check"><input type="checkbox" checked={items.includes(c.id)} onChange={() => setItems(toggle(items, c.id))} /> {c.label}</label>
            ))}
          </div>
        )}
        {type === "chart" && (
          <select className="select" value={chart} onChange={(e) => setChart(e.target.value)}>
            <option value="areas:ward">Blighted parcels by ward</option>
            <option value="areas:neighborhood">Top neighborhoods (unofficial boundaries)</option>
            <option value="areas:tract">Top census tracts</option>
            <option value="trend:">Each week: verified, City actions, demolished</option>
            <option value="stages:">Parcels at each stage of City action</option>
          </select>
        )}
        {type === "map" && (
          <>
            <select className="select" value={ward} onChange={(e) => setWard(e.target.value)}>
              <option value="">Whole city</option>
              {wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
            </select>
            <div className="checks">
              {STATUSES.map((s) => (
                <label key={s.id} className="check"><input type="checkbox" checked={statuses.includes(s.id)} onChange={() => setStatuses(toggle(statuses, s.id))} /> {s.label}</label>
              ))}
            </div>
            <input className="input" placeholder="Focus on a parcel ID (optional)" value={parcel} onChange={(e) => setParcel(e.target.value)} />
          </>
        )}
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">Embed code</span>
          <textarea className="textarea" readOnly value={snippet} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} />
        </label>
        <button className="btn" onClick={async () => { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? "Copied" : "Copy embed code"}
        </button>
      </section>
      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        {origin && <iframe key={path} src={path} title="Preview" style={{ width: "100%", height, border: 0, display: "block" }} />}
      </section>
    </div>
  );
}
