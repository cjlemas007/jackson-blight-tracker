/** Source documents: council agendas, city records, records-request CSVs. */
import { randomUUID } from "node:crypto";
import { getPool } from "./db";
import type { Staff } from "./auth/staff";
import { WorkflowError } from "./submissions";

export const DOC_TYPES: Record<string, { ext: string; kind: string }> = {
  "application/pdf": { ext: "pdf", kind: "pdf" },
  "text/csv": { ext: "csv", kind: "csv" },
  "application/vnd.ms-excel": { ext: "csv", kind: "csv" }, // what some browsers report for .csv
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
};
export const MAX_DOC_BYTES = 30 * 1024 * 1024;

export async function createDocumentSlot(
  staff: Staff,
  input: { name: string; mime: string; bytes: number; public: boolean; title?: string; date?: string | null },
): Promise<{ documentId: string; key: string }> {
  if (staff.role !== "admin") throw new WorkflowError("Admins only.", 403);
  const t = DOC_TYPES[input.mime];
  if (!t) throw new WorkflowError("Upload a PDF, CSV, JPEG or PNG.");
  if (input.bytes <= 0 || input.bytes > MAX_DOC_BYTES) throw new WorkflowError("Files must be under 30 MB.");
  // CSVs from records requests can hold personal data: never public.
  const isPublic = input.public && t.kind !== "csv";
  const id = randomUUID();
  const key = `docs/${isPublic ? "public" : "private"}/${id}.${t.ext}`;
  await getPool().query(
    `INSERT INTO app.documents (id, kind, storage_key, original_name, mime_type, bytes, uploaded_by, public, title, document_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, t.kind, key, input.name.slice(0, 200), input.mime, input.bytes, staff.id, isPublic, input.title?.slice(0, 200) || input.name.slice(0, 200), input.date || null],
  );
  return { documentId: id, key };
}

/** Dev upload route: the key must belong to a not-yet-uploaded document this admin created. */
export async function documentSlotForUpload(staff: Staff, key: string) {
  const { rows } = await getPool().query<{ id: string; mime_type: string }>(
    "SELECT id, mime_type FROM app.documents WHERE storage_key = $1 AND uploaded_by = $2 AND uploaded_at IS NULL",
    [key, staff.id],
  );
  if (!rows[0] || staff.role !== "admin") throw new WorkflowError("No upload is expected for that file.", 403);
  return rows[0];
}

export async function markDocumentUploaded(documentId: string, exists: (key: string) => Promise<boolean>) {
  const { rows } = await getPool().query<{ storage_key: string }>("SELECT storage_key FROM app.documents WHERE id = $1", [documentId]);
  if (!rows[0] || !(await exists(rows[0].storage_key))) throw new WorkflowError("The file hasn't finished uploading.");
  await getPool().query("UPDATE app.documents SET uploaded_at = COALESCE(uploaded_at, now()) WHERE id = $1", [documentId]);
}

export async function getDocument(id: string) {
  const { rows } = await getPool().query<{
    id: string; storage_key: string; mime_type: string; public: boolean; original_name: string; title: string | null; uploaded_at: string | null;
  }>("SELECT id, storage_key, mime_type, public, original_name, title, uploaded_at FROM app.documents WHERE id = $1", [id]);
  return rows[0] ?? null;
}
