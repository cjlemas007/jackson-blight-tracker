"use client";

export async function post<T = { ok: boolean }>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
  return out as T;
}

/** Upload a document straight to storage; returns its id once the server confirms it's stored. */
export async function uploadDocument(file: File, opts: { public: boolean; title?: string; date?: string }): Promise<string> {
  const mime = file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "");
  const slot = await post<{ documentId: string; upload: { url: string; method: string; headers: Record<string, string> } }>(
    "/api/admin/documents",
    { name: file.name, mime, bytes: file.size, public: opts.public, title: opts.title, date: opts.date },
  );
  const res = await fetch(slot.upload.url, { method: slot.upload.method, headers: { ...slot.upload.headers, "Content-Type": mime }, body: file });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  await post(`/api/admin/documents/${slot.documentId}/uploaded`, {});
  return slot.documentId;
}

export const ACTION_OPTIONS = [
  { substatus: "cited", label: "Cited" },
  { substatus: "hearing_set", label: "Hearing set" },
  { substatus: "adjudicated", label: "Adjudicated by council" },
  { substatus: "demolition_ordered", label: "Demolition ordered" },
  { substatus: "lot_cleanup_ordered", label: "Lot cleanup ordered" },
  { substatus: "lien_filed", label: "Lien filed" },
  { substatus: "demolished", label: "Demolished" },
  { substatus: "repaired", label: "Repaired" },
  { substatus: "lot_cleared", label: "Lot cleared" },
];
export const actionLabel = (s: string | null | undefined) => ACTION_OPTIONS.find((a) => a.substatus === s)?.label ?? s ?? "";
