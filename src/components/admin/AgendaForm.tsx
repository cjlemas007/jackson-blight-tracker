"use client";

import { useState } from "react";
import { ACTION_OPTIONS, post, uploadDocument } from "./api";

export default function AgendaForm() {
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [sub, setSub] = useState("adjudicated");
  const [lines, setLines] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = lines.split(/\r?\n/).filter((l) => l.trim()).length;
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const t = title || `City Council meeting ${date}`;
          const documentId = pdf ? await uploadDocument(pdf, { public: true, title: t, date }) : null;
          const { id } = await post<{ id: string }>("/api/admin/agenda", { title: t, meetingDate: date, substatus: sub, lines, documentId });
          window.location.href = `/admin/imports/${id}`;
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div className="row">
        <label className="stack" style={{ gap: 4, flex: "0 0 180px" }}>
          <span className="muted small">Meeting date</span>
          <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, flex: "1 1 220px" }}>
          <span className="muted small">What the council did</span>
          <select className="select" value={sub} onChange={(e) => setSub(e.target.value)}>
            {ACTION_OPTIONS.filter((a) => ["adjudicated", "demolition_ordered", "lot_cleanup_ordered", "hearing_set", "lien_filed"].includes(a.substatus)).map((a) => (
              <option key={a.substatus} value={a.substatus}>{a.label}</option>
            ))}
          </select>
        </label>
      </div>
      <input className="input" placeholder="Name (optional), e.g. Council regular meeting, item 12" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted small">Addresses or parcel IDs, one per line ({count})</span>
        <textarea className="textarea" style={{ minHeight: 200, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 14 }}
          placeholder={"522 Burns St\n1418 Robinson St\n4854-104-6"} value={lines} onChange={(e) => setLines(e.target.value)} />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted small">Agenda PDF (public: linked from each parcel&apos;s history)</span>
        <input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
      </label>
      {error && <div className="error">{error}</div>}
      <button className="btn" style={{ alignSelf: "flex-start" }} disabled={busy || !date || count === 0}>
        {busy ? "Matching…" : `Match ${count} line${count === 1 ? "" : "s"} and review`}
      </button>
      <p className="muted small" style={{ margin: 0 }}>You&apos;ll check every match before anything is recorded.</p>
    </form>
  );
}
