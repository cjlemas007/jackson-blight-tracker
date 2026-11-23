import { handle, requireApiStaff } from "@/lib/auth/session";
import { createAgendaBatch, type AgendaEntry } from "@/lib/imports";

export const POST = handle(async (req: Request) => {
  const admin = await requireApiStaff(req, "admin");
  const b = (await req.json()) as {
    title?: string; meetingDate?: string; substatus?: string; lines?: string; entries?: AgendaEntry[]; documentId?: string;
  };
  const entries = Array.isArray(b.entries)
    ? b.entries.map((e) => ({
        item: e.item ? String(e.item) : null, substatus: String(e.substatus ?? ""),
        parcelId: e.parcelId ? String(e.parcelId) : null, address: e.address ? String(e.address) : null, caseNo: e.caseNo ? String(e.caseNo) : null,
      }))
    : undefined;
  const id = await createAgendaBatch(admin, {
    title: String(b.title ?? ""), meetingDate: String(b.meetingDate ?? ""), substatus: b.substatus ? String(b.substatus) : undefined,
    lines: entries ? undefined : String(b.lines ?? ""), entries, documentId: b.documentId || null,
  });
  return Response.json({ id });
});
