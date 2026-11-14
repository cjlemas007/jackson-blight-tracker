"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { CONDITIONS, MAX_PHOTOS, NOTE_MAX } from "@/lib/approval";

const ParcelPickerMap = dynamic(() => import("./ParcelPickerMap"), { ssr: false });

interface ParcelHit {
  parcel_id: string;
  situs_address: string | null;
  owner_name: string | null;
  status: string;
  distance_m?: number;
}

interface PhotoItem {
  localId: string;
  photoId?: string;
  name: string;
  previewUrl: string;
  state: "uploading" | "uploaded" | "error";
  error?: string;
}

export interface ResumeInfo {
  submissionId: string;
  parcel: ParcelHit;
  reason: string | null;
  conditions: string[];
  note: string | null;
  existingPhotos: number;
}

const STATUS_TEXT: Record<string, string> = {
  unreported: "Not reported yet",
  verified_blighted: "Already verified (your photos will add to its timeline)",
  city_action: "City action pending (your photos will add to its timeline)",
  city_flagged: "City-flagged, not yet verified (your photos can verify it)",
  resolved: "Resolved (your photos will add to its timeline)",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export default function SubmitFlow({ resume, initialParcel = null }: { resume: ResumeInfo | null; initialParcel?: ParcelHit | null }) {
  const [parcel, setParcel] = useState<ParcelHit | null>(resume?.parcel ?? initialParcel);
  const [submissionId, setSubmissionId] = useState<string | null>(resume?.submissionId ?? null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ParcelHit[]>([]);
  const [finder, setFinder] = useState<"search" | "near" | "map">("search");
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [conditions, setConditions] = useState<string[]>(resume?.conditions ?? []);
  const [note, setNote] = useState(resume?.note ?? "");
  const [vantage, setVantage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Debounced address / parcel-id search.
  useEffect(() => {
    if (finder !== "search" || query.trim().length < 2) {
      if (finder === "search") setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setHits(await api<ParcelHit[]>(`/api/search/parcels?q=${encodeURIComponent(query)}`).catch(() => []));
    }, 250);
    return () => clearTimeout(t);
  }, [query, finder]);

  const choose = async (p: ParcelHit) => {
    setParcel(p);
    setHits([]);
    setError(null);
  };

  const chooseById = async (id: string) => {
    const p = await api<ParcelHit & { in_city: boolean }>(`/api/parcels/Hinds/${encodeURIComponent(id)}`).catch(() => null);
    if (!p) return setError("Couldn't load that parcel.");
    if (!p.in_city) return setError("That parcel is outside Jackson city limits.");
    choose(p);
  };

  const nearMe = () => {
    setFinder("near");
    setError(null);
    if (!navigator.geolocation) return setError("This browser can't share your location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocating(false);
        setMapCenter([pos.coords.longitude, pos.coords.latitude]);
        setHits(await api<ParcelHit[]>(`/api/parcels/near?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`).catch(() => []));
      },
      (err) => {
        setLocating(false);
        setError(err.code === err.PERMISSION_DENIED ? "Location permission was denied." : "Couldn't get your location.");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const startOver = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPhotos([]);
    setParcel(null);
    setSubmissionId(null);
  };

  const ensureDraft = async (): Promise<string> => {
    if (submissionId) return submissionId;
    const { id } = await api<{ id: string }>("/api/submissions", {
      method: "POST",
      body: JSON.stringify({ parcelId: parcel!.parcel_id }),
    });
    setSubmissionId(id);
    return id;
  };

  const totalPhotos = (resume?.existingPhotos ?? 0) + photos.length;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || !parcel) return;
    setError(null);
    const room = MAX_PHOTOS - totalPhotos;
    const list = [...files].slice(0, room);
    if (files.length > room) setError(`Up to ${MAX_PHOTOS} photos per submission.`);
    let id: string;
    try {
      id = await ensureDraft();
    } catch (e) {
      return setError((e as Error).message);
    }
    for (const file of list) {
      const localId = crypto.randomUUID();
      const item: PhotoItem = { localId, name: file.name, previewUrl: URL.createObjectURL(file), state: "uploading" };
      setPhotos((ps) => [...ps, item]);
      const update = (patch: Partial<PhotoItem>) => setPhotos((ps) => ps.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));
      try {
        const slot = await api<{ photoId: string; upload: { url: string; method: string; headers: Record<string, string> } }>(
          `/api/submissions/${id}/photos`,
          { method: "POST", body: JSON.stringify({ name: file.name, mime: file.type, bytes: file.size }) },
        );
        update({ photoId: slot.photoId });
        const res = await fetch(slot.upload.url, { method: slot.upload.method, headers: slot.upload.headers, body: file });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        update({ state: "uploaded" });
      } catch (e) {
        update({ state: "error", error: (e as Error).message });
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeItem = async (p: PhotoItem) => {
    if (p.photoId) await fetch(`/api/photos/${p.photoId}`, { method: "DELETE" }).catch(() => undefined);
    URL.revokeObjectURL(p.previewUrl);
    setPhotos((ps) => ps.filter((x) => x.localId !== p.localId));
  };

  const ready =
    !!parcel &&
    photos.length > 0 &&
    photos.every((p) => p.state === "uploaded") &&
    conditions.length > 0 &&
    vantage &&
    note.length <= NOTE_MAX;

  const send = async () => {
    if (!submissionId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/submissions/${submissionId}/submit`, {
        method: "POST",
        body: JSON.stringify({ conditions, note, vantageConfirmed: vantage }),
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Sent for review</h2>
        <p style={{ margin: 0 }}>
          {parcel?.situs_address ?? parcel?.parcel_id} is in the review queue. Nothing is public until an admin approves it.
        </p>
        <div className="row">
          <a className="btn" href="/submit">Submit another</a>
          <a className="btn secondary" href="/my">My submissions</a>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      {resume?.reason && (
        <div className="card warn">
          <strong>An admin asked for a better photo:</strong> {resume.reason}
        </div>
      )}

      {/* 1. Parcel */}
      <section className="card stack">
        <h2>1. Which property?</h2>
        {parcel ? (
          <div className="stack">
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{parcel.situs_address ?? "No street address"}</div>
              <div className="muted">
                Parcel {parcel.parcel_id} · {parcel.owner_name ?? "owner unknown"}
              </div>
              <div className="muted small">{STATUS_TEXT[parcel.status] ?? parcel.status}</div>
            </div>
            {!resume && (
              <button className="btn secondary" onClick={startOver} type="button">
                {photos.length ? "Start over with a different property" : "Change property"}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="seg" role="group">
              <button type="button" aria-pressed={finder === "search"} onClick={() => setFinder("search")}>Address</button>
              <button type="button" aria-pressed={finder === "near"} onClick={nearMe}>Near me</button>
              <button type="button" aria-pressed={finder === "map"} onClick={() => setFinder("map")}>Map</button>
            </div>
            {finder === "search" && (
              <input
                className="input"
                autoFocus
                placeholder="Street address or parcel ID, e.g. 522 Burns"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            {finder === "near" && locating && <div className="muted">Finding your location…</div>}
            {finder === "map" && (
              <>
                <div className="muted small">Zoom in until parcel outlines appear, then tap the property.</div>
                <ParcelPickerMap center={mapCenter} onPick={chooseById} />
              </>
            )}
            {hits.length > 0 && (
              <ul className="results">
                {hits.map((h) => (
                  <li key={h.parcel_id}>
                    <button type="button" onClick={() => choose(h)}>
                      <strong>{h.situs_address ?? "No street address"}</strong>
                      {h.distance_m !== undefined && <span className="muted"> · {h.distance_m} m away</span>}
                      <div className="muted small">
                        Parcel {h.parcel_id} · {h.owner_name}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {finder === "search" && query.trim().length >= 2 && hits.length === 0 && (
              <div className="muted small">No Jackson parcels match yet. Try just the number and street name.</div>
            )}
          </>
        )}
      </section>

      {/* 2. Photos */}
      <section className="card stack" aria-disabled={!parcel} style={!parcel ? { opacity: 0.5 } : undefined}>
        <h2>2. Photos ({totalPhotos}/{MAX_PHOTOS})</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Take photos from the street, the sidewalk, or your own property. Location and time are read from the photo,
          then removed before anything is published. Faces and plates are blurred.
        </p>
        {photos.length > 0 && (
          <div className="thumbs">
            {photos.map((p) => (
              <div className="thumb" key={p.localId}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt={p.name} />
                <span className="tag">{p.state === "uploading" ? "Uploading…" : p.state === "error" ? "Failed" : "Ready"}</span>
                <button type="button" className="x" aria-label={`Remove ${p.name}`} onClick={() => removeItem(p)}>×</button>
              </div>
            ))}
          </div>
        )}
        {photos.some((p) => p.state === "error") && (
          <div className="error">{photos.find((p) => p.state === "error")?.error}. Remove it and try again.</div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
        <button
          type="button"
          className="btn secondary block"
          disabled={!parcel || totalPhotos >= MAX_PHOTOS}
          onClick={() => fileInput.current?.click()}
        >
          {photos.length ? "Add another photo" : "Take or choose photos"}
        </button>
      </section>

      {/* 3. Conditions */}
      <section className="card stack" style={!parcel ? { opacity: 0.5 } : undefined}>
        <h2>3. What do the photos show?</h2>
        <div className="checks">
          {CONDITIONS.map((c) => (
            <label key={c.id} className="check" style={{ fontSize: 16, padding: "4px 0" }}>
              <input
                type="checkbox"
                checked={conditions.includes(c.id)}
                onChange={() =>
                  setConditions((cs) => (cs.includes(c.id) ? cs.filter((x) => x !== c.id) : [...cs, c.id]))
                }
              />
              {c.label}
            </label>
          ))}
        </div>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Note (optional)</span>
          <textarea
            className="textarea"
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the reviewer should know"
          />
          <span className="muted small" style={{ alignSelf: "flex-end" }}>{note.length}/{NOTE_MAX}</span>
        </label>
        <label className="check" style={{ fontSize: 15, alignItems: "flex-start" }}>
          <input type="checkbox" checked={vantage} onChange={(e) => setVantage(e.target.checked)} style={{ marginTop: 3 }} />
          I took these photos from the street, the sidewalk, or my own property.
        </label>
      </section>

      {error && <div className="error" role="alert">{error}</div>}
      <button type="button" className="btn block" disabled={!ready || busy} onClick={send}>
        {busy ? "Sending…" : resume ? "Send the new photos for review" : "Send for review"}
      </button>
    </div>
  );
}
