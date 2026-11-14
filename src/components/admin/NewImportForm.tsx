"use client";

import { useState } from "react";
import { post, uploadDocument } from "./api";

const KINDS = [
  { key: "demolition_list", label: "City demolition list" },
  { key: "code_enforcement", label: "Code enforcement case log" },
  { key: "sos_forfeited", label: "Secretary of State tax-forfeited list" },
];

export default function NewImportForm() {
  const [kind, setKind] = useState("demolition_list");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return setError("Choose a CSV file.");
        setBusy(true);
        setError(null);
        try {
          const documentId = await uploadDocument(file, { public: false, title: title || file.name });
          const { id } = await post<{ id: string }>("/api/admin/imports", { kind, title: title || file.name, documentId });
          window.location.href = `/admin/imports/${id}`;
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <h2>New CSV import</h2>
      <div className="row">
        <select className="select" style={{ flex: "1 1 240px" }} value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <input className="input" style={{ flex: "2 1 280px" }} placeholder="Name (e.g. Demolitions FY2026, records request #123)" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <p className="muted small" style={{ margin: 0 }}>
        Export spreadsheets as CSV with a header row. The file is stored privately (records may hold personal details).
        Next you&apos;ll pick which columns hold the parcel ID, address and date, then review the matches before anything is recorded.
      </p>
      {error && <div className="error">{error}</div>}
      <button className="btn" style={{ alignSelf: "flex-start" }} disabled={busy}>{busy ? "Uploading…" : "Upload and continue"}</button>
    </form>
  );
}
