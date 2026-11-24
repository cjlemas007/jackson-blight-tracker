"use client";

import { useEffect, useState } from "react";
import { ACTION_OPTIONS, actionLabel, post } from "./api";

interface Row {
  id: number;
  row_num: number;
  raw: Record<string, string>;
  input_parcel_id: string | null;
  input_address: string | null;
  input_case_no: string | null;
  agenda_item: string | null;
  event_date: string | null;
  event_substatus: string | null;
  note: string | null;
  match_parcel_id: string | null;
  match_method: string | null;
  match_score: number | null;
  candidates: { parcel_id: string; situs_address: string | null; score?: number }[];
  decision: "pending" | "accepted" | "skipped" | "waiting_case";
  apply_result: string | null;
  match_address: string | null;
  match_owner: string | null;
  match_in_city: boolean | null;
}

interface Batch {
  id: string;
  kind: string;
  status: string;
  headers: string[];
  mapping: Record<string, string> | null;
  default_date: string | null;
  event_substatus: string | null;
  stats: Record<string, unknown>;
  rows: Row[];
}

const ROWS_PER_PAGE = 200;

const METHOD: Record<string, string> = {
  parcel_id: "parcel ID", dpin: "DPIN", address_exact: "exact address", address_fuzzy: "similar address", manual: "picked by admin",
  case_no: "case number",
};

function guess(headers: string[], words: RegExp) {
  return headers.find((h) => words.test(h.toLowerCase())) ?? "";
}

function Mapping({ batch }: { batch: Batch }) {
  const h = batch.headers;
  const [parcelId, setParcelId] = useState(batch.mapping?.parcelId ?? guess(h, /parcel|ppin|pin\b|tax ?id/));
  const [address, setAddress] = useState(batch.mapping?.address ?? guess(h, /address|street|location|situs/));
  const [caseNo, setCaseNo] = useState(batch.mapping?.caseNo ?? guess(h, /case/));
  const [date, setDate] = useState(batch.mapping?.date ?? guess(h, /date/));
  const [note, setNote] = useState(batch.mapping?.note ?? "");
  const [defaultDate, setDefaultDate] = useState(batch.default_date ?? "");
  const [sub, setSub] = useState(batch.event_substatus ?? "cited");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const col = (label: string, v: string, set: (s: string) => void, optional = true) => (
    <label className="stack" style={{ gap: 4, flex: "1 1 200px" }}>
      <span className="muted small">{label}</span>
      <select className="select" value={v} onChange={(e) => set(e.target.value)}>
        <option value="">{optional ? "(none)" : "Pick a column"}</option>
        {h.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </label>
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card stack">
        <h2>1. Which columns?</h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          {col("Parcel ID column", parcelId, setParcelId)}
          {col("Address column", address, setAddress)}
          {col("Date column", date, setDate)}
          {col("Case number column", caseNo, setCaseNo)}
          {col("Note column", note, setNote)}
        </div>
        <label className="stack" style={{ gap: 4, maxWidth: 260 }}>
          <span className="muted small">{batch.kind === "sos_forfeited" ? "List date" : "Date for rows without one"}</span>
          <input className="input" type="date" value={defaultDate} onChange={(e) => setDefaultDate(e.target.value)} />
        </label>
        {batch.kind !== "sos_forfeited" && (
          <label className="stack" style={{ gap: 4, maxWidth: 320 }}>
            <span className="muted small">What these records show (can be changed per row)</span>
            <select className="select" value={sub} onChange={(e) => setSub(e.target.value)}>
              {ACTION_OPTIONS.map((a) => <option key={a.substatus} value={a.substatus}>{a.label}</option>)}
            </select>
          </label>
        )}
      </section>
      <section className="card">
        <h2>First rows of the file</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr>{h.map((x) => <th key={x}>{x}</th>)}</tr></thead>
            <tbody>
              {batch.rows.slice(0, 5).map((r) => (
                <tr key={r.id}>{h.map((x) => <td key={x} className="small">{r.raw[x]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {error && <div className="error">{error}</div>}
      <button
        className="btn"
        style={{ alignSelf: "flex-start" }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await post(`/api/admin/imports/${batch.id}/map`, {
              mapping: { parcelId: parcelId || null, address: address || null, caseNo: caseNo || null, date: date || null, note: note || null },
              defaultDate: defaultDate || null,
              substatus: batch.kind === "sos_forfeited" ? null : sub,
            });
            window.location.reload();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Matching rows…" : "Match rows to parcels"}
      </button>
    </div>
  );
}

function ParcelSearch({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ parcel_id: string; situs_address: string | null; owner_name: string | null }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search/parcels?q=${encodeURIComponent(q)}`);
      setHits(r.ok ? await r.json() : []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <input className="input" style={{ fontSize: 14, padding: "6px 8px" }} placeholder="Search address or parcel ID" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <ul className="results">
          {hits.map((h) => (
            <li key={h.parcel_id}>
              <button type="button" onClick={() => { onPick(h.parcel_id); setQ(""); setHits([]); }} style={{ fontSize: 13, padding: "6px 8px" }}>
                {h.situs_address ?? "No address"} <span className="muted">· {h.parcel_id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewRow({ batch, r, onChange }: { batch: Batch; r: Row; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const editable = batch.status === "review";
  const update = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      await post(`/api/admin/imports/${batch.id}/rows/${r.id}`, { decision: r.decision, ...body });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <tr style={r.decision === "skipped" ? { opacity: 0.5 } : undefined}>
      <td className="num small">{r.row_num}</td>
      <td className="small">
        {r.agenda_item && <div className="muted">{/^\d+$/.test(r.agenda_item) ? `Item ${r.agenda_item}` : r.agenda_item}</div>}
        {r.input_parcel_id && <div>ID {r.input_parcel_id}</div>}
        {r.input_address && <div>{r.input_address}</div>}
        {r.input_case_no && <div>Case {r.input_case_no}</div>}
        {r.note && (!r.agenda_item || /skipped:|vote/.test(r.note)) && <div className="muted">{r.note}</div>}
      </td>
      <td className="small">{r.event_date ?? batch.default_date ?? <span className="error">none</span>}</td>
      <td className="small">
        {r.match_parcel_id ? (
          <>
            <strong>{r.match_address ?? "No address"}</strong> · {r.match_parcel_id}
            <div className="muted">
              {r.match_owner ?? "Owner unknown"} · {METHOD[r.match_method ?? ""] ?? r.match_method}
              {r.match_method === "address_fuzzy" && r.match_score !== null && ` (${Math.round(r.match_score * 100)}% similar)`}
              {r.match_in_city === false && " · outside city limits"}
            </div>
          </>
        ) : r.decision === "waiting_case" ? (
          <span className="muted">
            {r.apply_result?.startsWith("moved:") ? (
              <>Matched later: <a href={`/admin/imports/${r.apply_result.slice(6)}`}>see the follow-up import</a></>
            ) : (
              <>Waiting: no case log links case {r.input_case_no} to a parcel yet. It&apos;s matched automatically once one does, or pick the parcel now.</>
            )}
          </span>
        ) : (
          <span className="muted">No match</span>
        )}
        {editable && r.decision === "pending" && r.candidates.length > 1 && (
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            {r.candidates.map((c) => (
              <button key={c.parcel_id} type="button" className="btn secondary" style={{ padding: "3px 8px", fontSize: 12 }}
                onClick={() => update({ parcelId: c.parcel_id, decision: "accepted" })}>
                {c.situs_address ?? c.parcel_id} ({c.parcel_id})
              </button>
            ))}
          </div>
        )}
        {editable && (r.decision === "pending" || r.decision === "waiting_case") && (
          <div style={{ marginTop: 4 }}><ParcelSearch onPick={(id) => update({ parcelId: id, decision: "accepted" })} /></div>
        )}
        {error && <div className="error">{error}</div>}
      </td>
      {batch.kind !== "sos_forfeited" && (
        <td className="small">
          {editable ? (
            <select className="select" style={{ fontSize: 13, padding: "4px 6px" }} value={r.event_substatus ?? batch.event_substatus ?? ""}
              onChange={(e) => update({ substatus: e.target.value })}>
              {ACTION_OPTIONS.map((a) => <option key={a.substatus} value={a.substatus}>{a.label}</option>)}
            </select>
          ) : actionLabel(r.event_substatus ?? batch.event_substatus)}
        </td>
      )}
      <td className="small">
        {editable ? (
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className={`btn ${r.decision === "accepted" ? "ok" : "secondary"}`} style={{ padding: "4px 8px", fontSize: 12 }}
              disabled={!r.match_parcel_id} onClick={() => update({ decision: "accepted" })}>Accept</button>
            <button type="button" className={`btn ${r.decision === "skipped" ? "danger" : "secondary"}`} style={{ padding: "4px 8px", fontSize: 12 }}
              onClick={() => update({ decision: "skipped" })}>Skip</button>
            {batch.kind === "council_agenda" && r.input_case_no && !r.match_parcel_id && r.decision !== "waiting_case" && (
              <button type="button" className="btn secondary" style={{ padding: "4px 8px", fontSize: 12 }}
                onClick={() => update({ decision: "waiting_case" })}>Wait for case log</button>
            )}
          </div>
        ) : r.apply_result?.startsWith("moved:") ? (
          "matched later"
        ) : (
          r.apply_result ?? (r.decision === "waiting_case" ? "waiting" : r.decision)
        )}
      </td>
    </tr>
  );
}

export default function ImportClient({ batch }: { batch: Batch }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "accepted" | "skipped" | "waiting_case">("all");
  const [shown, setShown] = useState(ROWS_PER_PAGE); // a case log has thousands of rows; draw them a page at a time
  if (batch.status === "mapping") return <Mapping batch={batch} />;
  const pending = batch.rows.filter((r) => r.decision === "pending").length;
  const accepted = batch.rows.filter((r) => r.decision === "accepted").length;
  const skipped = batch.rows.filter((r) => r.decision === "skipped").length;
  // A case log's case-number-only batch has nothing to accept: recording it just links case numbers to parcels.
  const casesOnly = batch.kind === "code_enforcement" && accepted === 0 && skipped > 0;
  const waiting = batch.rows.filter((r) => r.decision === "waiting_case" && !r.apply_result).length;
  const followUpOf = (batch.stats as { followUpOf?: string }).followUpOf;
  const rows = filter === "all" ? batch.rows : batch.rows.filter((r) => r.decision === filter);
  const applied = (batch.stats as { applied?: Record<string, number> }).applied;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="counters">
        <div className="counter"><div className="n">{accepted}</div><div className="l">matched, will be recorded</div></div>
        <div className="counter"><div className="n">{pending}</div><div className="l">need a decision</div></div>
        {waiting > 0 && <div className="counter"><div className="n">{waiting}</div><div className="l">waiting for a case log</div></div>}
        <div className="counter"><div className="n">{skipped}</div><div className="l">skipped</div></div>
      </div>
      {followUpOf && (
        <div className="card small">
          These rows were listed only by case number in <a href={`/admin/imports/${followUpOf}`}>an earlier import</a>. A case log has since linked
          them to parcels. Check the matches, then record them.
        </div>
      )}
      {batch.status === "applied" && applied && (
        <div className="card">
          Applied: {applied.events ?? 0} new entries{applied.listed ? `, ${applied.listed} listed on the State inventory` : ""},{" "}
          {applied.duplicates ?? 0} already on record (not duplicated), {applied.skipped ?? 0} skipped
          {applied.waiting ? `, ${applied.waiting} waiting for a case log` : ""}.
          {waiting > 0 && " Waiting rows are matched automatically when a code-enforcement case log that links their case numbers is recorded."}
        </div>
      )}
      {batch.status === "review" && (
        <div className="card stack">
          <div>
            Rows matched to exactly one parcel by ID or exact address are accepted. Check the rest: pick a candidate, search
            for the right parcel, or skip. Nothing is recorded until you apply.
            {waiting > 0 && ` ${waiting} row${waiting === 1 ? "" : "s"} listed only by case number will wait: they don't hold up recording the rest.`}
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="btn ok" disabled={busy || pending > 0 || (accepted === 0 && !casesOnly)} onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await post(`/api/admin/imports/${batch.id}/apply`, {});
                window.location.reload();
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}>
              {pending > 0 ? `Decide ${pending} more row${pending > 1 ? "s" : ""} to apply`
                : casesOnly ? `Record (links ${skipped} case number${skipped === 1 ? "" : "s"}, changes no statuses)`
                : `Record ${accepted} row${accepted === 1 ? "" : "s"}`}
            </button>
            <button className="btn secondary" disabled={busy} onClick={async () => {
              if (!confirm("Discard this import? Nothing from it will be recorded.")) return;
              await post(`/api/admin/imports/${batch.id}/discard`, {});
              window.location.href = "/admin/imports";
            }}>Discard import</button>
          </div>
        </div>
      )}
      <nav className="tabs">
        {(["all", "pending", "accepted", "waiting_case", "skipped"] as const).filter((f) => f !== "waiting_case" || waiting > 0).map((f) => (
          <a key={f} href="#" aria-current={filter === f ? "page" : undefined} onClick={(e) => { e.preventDefault(); setFilter(f); setShown(ROWS_PER_PAGE); }}>
            {f === "all" ? `All (${batch.rows.length})` : f === "pending" ? `Need a decision (${pending})` : f === "accepted" ? `Accepted (${accepted})`
              : f === "waiting_case" ? `Waiting for case log (${waiting})` : `Skipped (${skipped})`}
          </a>
        ))}
      </nav>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>#</th><th>From the file</th><th>Date</th><th>Matched parcel</th>
              {batch.kind !== "sos_forfeited" && <th>Action</th>}<th>{batch.status === "applied" ? "Result" : "Decision"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r) => <ReviewRow key={r.id} batch={batch} r={r} onChange={() => window.location.reload()} />)}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <div className="row">
          <span className="muted">Showing {shown} of {rows.length} rows.</span>
          <button className="btn secondary" onClick={() => setShown((n) => n + ROWS_PER_PAGE)}>Show {Math.min(ROWS_PER_PAGE, rows.length - shown)} more</button>
          <button className="btn secondary" onClick={() => setShown(rows.length)}>Show all</button>
        </div>
      )}
    </div>
  );
}
