"use client";

import { useState } from "react";
import { ACTION_OPTIONS, post, uploadDocument } from "./api";

const COUNCIL_ACTIONS = ACTION_OPTIONS.filter((a) =>
  ["adjudicated", "demolition_ordered", "lot_cleanup_ordered", "hearing_set", "lien_filed"].includes(a.substatus),
);

interface Target {
  caseNo: string | null;
  parcelId: string | null;
  address: string | null;
  excluded?: string | null;
}
interface Item {
  number: string | null;
  section: string | null;
  text: string;
  relevant: boolean;
  substatus: string | null;
  targets: Target[];
  adopted?: boolean | null;
  vote?: string | null;
}
interface Read {
  kind: "agenda" | "minutes";
  meetingDate: string | null;
  title: string | null;
  items: Item[];
}

function ActionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {COUNCIL_ACTIONS.map((a) => <option key={a.substatus} value={a.substatus}>{a.label}</option>)}
    </select>
  );
}

const targetLabel = (t: Target) =>
  [t.address, t.parcelId && `parcel ${t.parcelId}`, t.caseNo && `case ${t.caseNo}`].filter(Boolean).join(" · ");

/** Upload an agenda PDF, read it, and pick which items and properties to record. */
function FromPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  // Per item: included?, action, and which of its properties are kept.
  const [pick, setPick] = useState<Record<number, { on: boolean; sub: string; keep: boolean[] }>>({});
  const [busy, setBusy] = useState<"" | "reading" | "matching">("");
  const [error, setError] = useState<string | null>(null);

  const readPdf = async () => {
    if (!file) return;
    setBusy("reading");
    setError(null);
    try {
      const id = documentId ?? (await uploadDocument(file, { public: true, title: file.name }));
      setDocumentId(id);
      const r = await post<Read>("/api/admin/agenda/read", { documentId: id });
      setRead(r);
      setDate(r.meetingDate ?? "");
      setTitle(r.title && r.meetingDate ? `${r.title}, ${r.meetingDate}` : r.title ?? "");
      const p: typeof pick = {};
      r.items.forEach((it, i) => {
        if (it.relevant) {
          p[i] = { on: it.targets.length > 0 && it.adopted !== false, sub: it.substatus ?? "adjudicated", keep: it.targets.map((t) => !t.excluded) };
        }
      });
      setPick(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const relevant = read ? read.items.map((it, i) => ({ it, i })).filter(({ it }) => it.relevant) : [];
  const others = read ? read.items.filter((it) => !it.relevant).length : 0;
  const entries = relevant.flatMap(({ it, i }) =>
    pick[i]?.on
      ? it.targets.filter((_, j) => pick[i].keep[j]).map((t) => ({ item: it.number, substatus: pick[i].sub, ...t }))
      : [],
  );
  const caseOnly = entries.filter((e) => e.caseNo && !e.parcelId && !e.address).length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack">
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">Agenda or minutes PDF, up to 30 MB (stored publicly: linked from each parcel&apos;s history)</span>
          <input type="file" accept="application/pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setDocumentId(null); setRead(null); }} />
        </label>
        <button className="btn" style={{ alignSelf: "flex-start" }} disabled={!file || !!busy} onClick={readPdf}>
          {busy === "reading" ? "Reading…" : "Read the agenda"}
        </button>
        {!read && <p className="muted small" style={{ margin: 0 }}>Finds the items about blighted property and the case numbers, parcel numbers and addresses they list. You choose what to record.</p>}
      </section>

      {read && (
        <>
          <section className="card stack">
            <div className="row">
              <label className="stack" style={{ gap: 4, flex: "0 0 180px" }}>
                <span className="muted small">Meeting date</span>
                <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="stack" style={{ gap: 4, flex: "1 1 260px" }}>
                <span className="muted small">Name</span>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="City Council regular meeting" />
              </label>
            </div>
            {!read.meetingDate && <div className="error">Couldn&apos;t find the meeting date in the PDF. Enter it above.</div>}
          </section>

          {relevant.length === 0 && (
            <div className="card">No items about blighted property were found in this PDF. Use &ldquo;Paste addresses&rdquo; if it lists some in a format this reader missed.</div>
          )}

          {relevant.map(({ it, i }) => {
            const p = pick[i];
            return (
              <section key={i} className="card stack" style={p?.on ? undefined : { opacity: 0.6 }}>
                <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                  <input type="checkbox" checked={!!p?.on} disabled={!it.targets.length}
                    onChange={(e) => setPick({ ...pick, [i]: { ...p, on: e.target.checked } })} />
                  <span>
                    <strong>{read.kind === "minutes" ? "Order" : "Item"} {it.number ?? "?"}</strong>
                    {it.section && <span className="muted small"> · {it.section.toLowerCase()}</span>}
                    {read.kind === "minutes" && (
                      <span className={it.adopted === false ? "error small" : "muted small"}>
                        {" · "}{it.adopted === false ? `not adopted (${it.vote})` : it.adopted ? `adopted ${it.vote}` : (it.vote ?? "vote not found: check the minutes")}
                      </span>
                    )}
                    <span className="small" style={{ display: "block", marginTop: 4 }}>
                      {it.text.length > 320 ? `${it.text.slice(0, 320)}…` : it.text}
                    </span>
                  </span>
                </label>
                {it.targets.length === 0 ? (
                  <div className="muted small">This item doesn&apos;t name any case numbers, parcels or addresses the reader could find.</div>
                ) : (
                  <>
                    <label className="stack" style={{ gap: 4, maxWidth: 320 }}>
                      <span className="muted small">What the council did</span>
                      <ActionSelect value={p.sub} onChange={(v) => setPick({ ...pick, [i]: { ...p, sub: v } })} />
                    </label>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {it.targets.map((t, j) => (
                        <label key={j} className="small" style={{ display: "inline-flex", gap: 4, alignItems: "center", border: "1px solid var(--rule)", borderRadius: 4, padding: "2px 6px", opacity: p.keep[j] ? 1 : 0.5 }}>
                          <input type="checkbox" checked={p.keep[j]} disabled={!p.on}
                            onChange={(e) => { const keep = [...p.keep]; keep[j] = e.target.checked; setPick({ ...pick, [i]: { ...p, keep } }); }} />
                          {targetLabel(t)}
                          {t.excluded && <span className="muted"> ({t.excluded.toLowerCase()})</span>}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </section>
            );
          })}

          {others > 0 && <p className="muted small" style={{ margin: 0 }}>{others} other item{others === 1 ? "" : "s"} on this agenda aren&apos;t about blighted property and were left out.</p>}

          {error && <div className="error">{error}</div>}
          <div className="card stack">
            <button className="btn" style={{ alignSelf: "flex-start" }} disabled={!!busy || !date || entries.length === 0}
              onClick={async () => {
                setBusy("matching");
                setError(null);
                try {
                  const { id } = await post<{ id: string }>("/api/admin/agenda", {
                    title: title || `City Council meeting ${date}`, meetingDate: date, entries, documentId,
                  });
                  window.location.href = `/admin/imports/${id}`;
                } catch (e) {
                  setError((e as Error).message);
                  setBusy("");
                }
              }}>
              {busy === "matching" ? "Matching…" : `Match ${entries.length} propert${entries.length === 1 ? "y" : "ies"} and review`}
            </button>
            <p className="muted small" style={{ margin: 0 }}>
              You&apos;ll check every match before anything is recorded.
              {caseOnly > 0 && ` ${caseOnly} listed only by case number: they're matched through code-enforcement case logs, and wait until a log links them to a parcel.`}
            </p>
          </div>
        </>
      )}
      {!read && error && <div className="error">{error}</div>}
    </div>
  );
}

/** The original quick entry: paste addresses or parcel IDs, one action for all. */
function Paste() {
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
          <ActionSelect value={sub} onChange={setSub} />
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

export default function AgendaForm() {
  const [mode, setMode] = useState<"pdf" | "paste">("pdf");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <nav className="tabs">
        <a href="#" aria-current={mode === "pdf" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setMode("pdf"); }}>Read an agenda PDF</a>
        <a href="#" aria-current={mode === "paste" ? "page" : undefined} onClick={(e) => { e.preventDefault(); setMode("paste"); }}>Paste addresses</a>
      </nav>
      {mode === "pdf" ? <FromPdf /> : <Paste />}
    </div>
  );
}
