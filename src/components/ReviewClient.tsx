"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BlurEditor, { type Box } from "./BlurEditor";

interface Photo {
  id: string;
  position: number;
  processing_status: string;
  processing_error: string | null;
  exif_taken_at: string | null;
  exif_camera: string | null;
  exif_lat: number | null;
  exif_lon: number | null;
  exif_distance_m: number | null;
  detector: string | null;
  auto_boxes: Box[];
  manual_boxes: Box[];
}

interface Detail {
  id: string;
  status: string;
  kind: string | null;
  parcel_id: string;
  situs_address: string | null;
  submitted_at: string | null;
  submitted_by_name: string;
  conditions: string[];
  note: string | null;
  vantage_confirmed: boolean;
  review_reason: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  parcel_status: string;
  photos: Photo[];
  prior: { id: string; status: string; kind: string; submitted_at: string; submitted_by_name: string; review_reason: string | null }[];
  parcel: Record<string, string | number | boolean | null> | null;
  audit: { at: string; action: string; actor: string | null; details: Record<string, unknown> }[];
}

const FAR_M = 75;
const OLD_DAYS = 90;
const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) : "—";
const usd = (n: unknown) =>
  typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "—";

interface Hit {
  parcel_id: string;
  situs_address: string | null;
  owner_name: string | null;
}

export default function ReviewClient({
  data,
  standard,
  conditions,
}: {
  data: Detail;
  standard: { id: string; text: string }[];
  conditions: { id: string; label: string }[];
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [manual, setManual] = useState<Record<string, Box[]>>(
    Object.fromEntries(data.photos.map((p) => [p.id, p.manual_boxes])),
  );
  const pending = data.status === "pending";
  const label = (id: string) => conditions.find((c) => c.id === id)?.label ?? id;
  const allChecked = standard.every((s) => checked[s.id]);
  const detectorMissing = data.photos.some((p) => p.detector === "unavailable");
  const failed = data.photos.filter((p) => p.processing_status === "failed");
  const far = data.photos.filter((p) => p.exif_distance_m !== null && p.exif_distance_m > FAR_M);
  const noGps = data.photos.filter((p) => p.processing_status === "done" && p.exif_distance_m === null);
  const old = data.photos.filter(
    (p) => p.exif_taken_at && Date.now() - new Date(p.exif_taken_at).getTime() > OLD_DAYS * 86400e3,
  );

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search/parcels?q=${encodeURIComponent(q)}`);
      setHits(r.ok ? await r.json() : []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/submissions/${data.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(out.error ?? "That didn't work.");
    window.location.href = body.action === "reassign" ? `/admin/submissions/${data.id}` : "/admin";
  };

  const p = data.parcel;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <Link href="/admin" className="muted small">← Review queue</Link>
          <h1 style={{ marginTop: 4 }}>{data.situs_address ?? data.parcel_id}</h1>
          <div className="muted">
            Parcel {data.parcel_id} · {data.kind === "follow_up" ? "Follow-up photos" : "New report"} · sent by{" "}
            {data.submitted_by_name} {fmt(data.submitted_at)}
          </div>
        </div>
        <span className={`pill ${data.status}`}>{data.status.replace("_", " ")}</span>
      </div>

      {detectorMissing && (
        <div className="card warn">
          <strong>Automatic face and plate detection isn&apos;t installed yet.</strong> Nothing has been blurred automatically:
          draw a box over every face and license plate before approving.
        </div>
      )}
      {!detectorMissing && data.photos.some((p) => p.processing_status === "done") && (
        <div className="card">
          Automatic detection found{" "}
          <strong>
            {data.photos.reduce((n, p) => n + p.auto_boxes.filter((b) => b.kind === "face").length, 0)} face(s) and{" "}
            {data.photos.reduce((n, p) => n + p.auto_boxes.filter((b) => b.kind === "plate").length, 0)} plate(s)
          </strong>{" "}
          (orange boxes, always blurred). It can miss small, turned or partly hidden faces and plates, so compare each photo
          with the original and draw boxes for anything it missed.
        </div>
      )}
      {failed.length > 0 && (
        <div className="card danger">
          {failed.length} photo{failed.length > 1 ? "s" : ""} failed processing ({failed[0].processing_error}). Request a new photo.
        </div>
      )}
      {far.length > 0 && (
        <div className="card warn">
          {far.length} photo{far.length > 1 ? "s were" : " was"} taken more than {FAR_M} m from this parcel (
          {far.map((f) => `${f.exif_distance_m} m`).join(", ")}). Check it&apos;s the right property, or reassign it.
        </div>
      )}
      {noGps.length > 0 && (
        <div className="card warn">{noGps.length} photo{noGps.length > 1 ? "s have" : " has"} no camera location. Confirm the property from the photo itself.</div>
      )}
      {old.length > 0 && <div className="card warn">The camera date on {old.length} photo{old.length > 1 ? "s is" : " is"} more than {OLD_DAYS} days old.</div>}

      <div className="review-grid">
        <div className="stack" style={{ gap: 18 }}>
          {data.photos.map((ph) => (
            <section key={ph.id} className="card stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>Photo {ph.position}</strong>
                <span className="muted small">
                  {ph.exif_taken_at ? `Taken ${fmt(ph.exif_taken_at)}` : "No camera date"}
                  {ph.exif_distance_m !== null && ` · ${ph.exif_distance_m} m from parcel`}
                  {ph.exif_camera && ` · ${ph.exif_camera}`}
                </span>
              </div>
              {ph.processing_status === "done" ? (
                <BlurEditor
                  photoId={ph.id}
                  autoBoxes={ph.auto_boxes}
                  manualBoxes={manual[ph.id] ?? []}
                  editable={pending}
                  onSaved={(b) => setManual((m) => ({ ...m, [ph.id]: b }))}
                />
              ) : (
                <div className="muted">{ph.processing_status === "failed" ? `Failed: ${ph.processing_error}` : "Still processing…"}</div>
              )}
              {ph.exif_lat !== null && (
                <a className="small" href={`/#19/${ph.exif_lat}/${ph.exif_lon}`} target="_blank" rel="noreferrer">
                  Where the camera was (map)
                </a>
              )}
            </section>
          ))}
        </div>

        <aside className="stack" style={{ gap: 18 }}>
          <section className="card stack">
            <h2>Submitted</h2>
            <div className="row" style={{ gap: 6 }}>
              {data.conditions.map((c) => <span key={c} className="pill">{label(c)}</span>)}
            </div>
            {data.note && <p style={{ margin: 0, fontSize: 14 }}>“{data.note}”</p>}
            <div className="muted small">
              {data.vantage_confirmed ? "Submitter confirmed: taken from street, sidewalk or own property." : "Vantage not confirmed."}
            </div>
          </section>

          {p && (
            <section className="card">
              <h2>Land roll</h2>
              <dl className="kv">
                <dt>Owner</dt><dd>{p.owner_name ?? "—"}{p.attributed_owner ? ` (${p.attributed_owner})` : ""}</dd>
                <dt>Source</dt><dd>{p.owner_source === "land_roll" ? "Land roll" : "Parcel map"}, as of {p.owner_as_of ?? "—"}</dd>
                <dt>Appraised</dt><dd>{usd(p.appraised_total)}</dd>
                <dt>Improvements</dt><dd>{usd(p.tv_imp)}</dd>
                <dt>Year built</dt><dd>{p.year_built ?? "—"}</dd>
                <dt>Taxes</dt><dd>{p.delinquent === null ? "No tax record" : p.delinquent ? `${usd(p.current_due)} unpaid` : "Current"}</dd>
                <dt>Homestead</dt><dd>{p.homestead ? "Yes" : "No"}</dd>
                <dt>Ward</dt><dd>{p.ward ?? "—"}</dd>
                <dt>Status now</dt><dd>{data.parcel_status.replace("_", " ")}</dd>
              </dl>
              {p.lat !== null && (
                <a className="small" href={`/#19/${p.lat}/${p.lon}`} target="_blank" rel="noreferrer">Open parcel on map</a>
              )}
            </section>
          )}

          <section className="card stack">
            <h2>Earlier submissions for this parcel</h2>
            {data.prior.length === 0 ? (
              <div className="muted small">None.</div>
            ) : (
              data.prior.map((r) => (
                <div key={r.id} style={{ fontSize: 14 }}>
                  <Link href={`/admin/submissions/${r.id}`}>{fmt(r.submitted_at)}</Link> · {r.submitted_by_name} ·{" "}
                  <span className={`pill ${r.status}`}>{r.status.replace("_", " ")}</span>
                  {r.review_reason && <div className="muted small">{r.review_reason}</div>}
                </div>
              ))
            )}
          </section>

          {pending ? (
            <>
              <section className="card stack checklist">
                <h2>Approval standard</h2>
                {standard.map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={!!checked[s.id]}
                      onChange={(e) => setChecked((c) => ({ ...c, [s.id]: e.target.checked }))}
                    />
                    <span>{s.text}</span>
                  </label>
                ))}
                <button
                  type="button"
                  className="btn ok block"
                  disabled={!allChecked || busy || failed.length > 0}
                  onClick={() => act({ action: "approve", checklist: checked })}
                >
                  Approve and publish
                </button>
              </section>

              <section className="card stack">
                <h2>Or send it back</h2>
                <textarea
                  className="textarea"
                  placeholder="Reason (shown to the submitter)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="row">
                  <button type="button" className="btn secondary" disabled={!reason.trim() || busy} onClick={() => act({ action: "request_photo", reason })}>
                    Request a better photo
                  </button>
                  <button type="button" className="btn danger" disabled={!reason.trim() || busy} onClick={() => act({ action: "reject", reason })}>
                    Reject
                  </button>
                </div>
              </section>

              <section className="card stack">
                <h2>Wrong parcel?</h2>
                <input className="input" placeholder="Find the right address" value={q} onChange={(e) => setQ(e.target.value)} />
                {hits.length > 0 && (
                  <ul className="results">
                    {hits.filter((h) => h.parcel_id !== data.parcel_id).map((h) => (
                      <li key={h.parcel_id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`Move this submission to ${h.situs_address ?? h.parcel_id}?`)) act({ action: "reassign", parcelId: h.parcel_id });
                          }}
                        >
                          <strong>{h.situs_address ?? "No address"}</strong>
                          <div className="muted small">{h.parcel_id} · {h.owner_name}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {error && <div className="error" role="alert">{error}</div>}
            </>
          ) : (
            <section className="card stack">
              <h2>Decision</h2>
              <div style={{ fontSize: 14 }}>
                {data.status === "approved" && "Approved"}
                {data.status === "rejected" && "Rejected"}
                {data.status === "needs_photo" && "Better photo requested"}
                {data.status === "processing" && "Photos still processing"}
                {data.reviewed_by_name && ` by ${data.reviewed_by_name}, ${fmt(data.reviewed_at)}`}
              </div>
              {data.review_reason && <div className="muted small">{data.review_reason}</div>}
            </section>
          )}

          <section className="card stack">
            <h2>History</h2>
            {data.audit.map((a, i) => (
              <div key={i} className="small">
                <span className="muted">{fmt(a.at)}</span> · {a.actor ?? "system"} · {a.action.replace("submission.", "").replace("_", " ")}
              </div>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}
