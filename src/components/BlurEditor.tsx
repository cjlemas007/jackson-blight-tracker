"use client";

import { useRef, useState } from "react";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: string;
  score?: number;
}

/**
 * Shows the blurred preview (or the original, for checking) with blur boxes on top.
 * Draw mode: drag on the photo to add a box. Manual boxes can be removed; detector
 * boxes (orange) always apply. Saving re-renders the published copy on the server.
 */
export default function BlurEditor({
  photoId,
  autoBoxes,
  manualBoxes,
  editable,
  onSaved,
}: {
  photoId: string;
  autoBoxes: Box[];
  manualBoxes: Box[];
  editable: boolean;
  onSaved: (boxes: Box[]) => void;
}) {
  const [boxes, setBoxes] = useState<Box[]>(manualBoxes);
  const [showOriginal, setShowOriginal] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Box | null>(null);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(boxes) !== JSON.stringify(manualBoxes);

  const rel = (e: React.PointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/photos/${photoId}/boxes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boxes }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(body.error ?? "Couldn't save the blur boxes.");
    setBoxes(body.boxes);
    onSaved(body.boxes);
    setVersion((v) => v + 1);
    setDrawing(false);
  };

  const box = (b: Box, i: number, kind: "auto" | "manual") => (
    <div
      key={`${kind}${i}`}
      className={`box ${kind}`}
      style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
      title={kind === "auto" ? `Detected ${b.kind ?? ""} (${Math.round((b.score ?? 0) * 100)}%)` : "Blur box"}
    >
      {kind === "manual" && editable && !showOriginal && (
        <button type="button" aria-label="Remove blur box" onClick={() => setBoxes((bs) => bs.filter((_, j) => j !== i))}>×</button>
      )}
    </div>
  );

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div
        ref={frame}
        className={`photo-edit${drawing ? " drawing" : ""}`}
        onPointerDown={(e) => {
          if (!drawing) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          start.current = rel(e);
          setDraft({ ...start.current, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!drawing || !start.current) return;
          const p = rel(e);
          const s = start.current;
          setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
        }}
        onPointerUp={() => {
          if (draft && draft.w > 0.01 && draft.h > 0.01) setBoxes((bs) => [...bs, { ...draft, kind: "manual" }]);
          start.current = null;
          setDraft(null);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/photos/${photoId}?v=${showOriginal ? "original" : "preview"}&r=${version}`}
          alt={showOriginal ? "Original upload" : "Published version (blurred)"}
          draggable={false}
        />
        {!showOriginal && autoBoxes.map((b, i) => box(b, i, "auto"))}
        {boxes.map((b, i) => box(b, i, "manual"))}
        {draft && box(draft, -1, "manual")}
      </div>
      <div className="row">
        <button type="button" className="btn secondary" onClick={() => setShowOriginal((s) => !s)}>
          {showOriginal ? "Show published version" : "Compare with original"}
        </button>
        {editable && (
          <>
            <button type="button" className="btn secondary" aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}>
              {drawing ? "Stop drawing" : "Draw blur box"}
            </button>
            <button type="button" className="btn" disabled={!dirty || saving} onClick={save}>
              {saving ? "Re-rendering…" : "Save blur boxes"}
            </button>
          </>
        )}
      </div>
      {showOriginal && <div className="muted small">Original upload, never published. Look for faces or plates the boxes missed.</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
