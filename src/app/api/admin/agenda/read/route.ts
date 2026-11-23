import { handle, requireApiStaff } from "@/lib/auth/session";
import { getDocument } from "@/lib/documents";
import { readAgendaPdf } from "@/lib/agendaPdf";
import { storage } from "@/lib/storage";
import { WorkflowError } from "@/lib/submissions";

// Reading a long agenda can take a few seconds.
export const maxDuration = 60;

/** Read an uploaded agenda PDF: its meeting date, numbered items, and the properties they name. */
export const POST = handle(async (req: Request) => {
  await requireApiStaff(req, "admin");
  const { documentId } = (await req.json()) as { documentId?: string };
  const doc = documentId ? await getDocument(String(documentId)) : null;
  if (!doc || !doc.uploaded_at) throw new WorkflowError("Upload the agenda PDF first.");
  if (doc.mime_type !== "application/pdf") throw new WorkflowError("That file isn't a PDF.");
  const buf = await storage().get(doc.storage_key);
  if (!buf) throw new WorkflowError("The PDF is missing from storage.");
  try {
    return Response.json(await readAgendaPdf(new Uint8Array(buf)));
  } catch (e) {
    const msg = (e as Error).message;
    if (/no readable text|pages aren't supported/.test(msg)) throw new WorkflowError(msg);
    console.error(e);
    throw new WorkflowError("Couldn't read that PDF. Paste the addresses or parcel numbers instead.");
  }
});
