import { handle, requireApiStaff } from "@/lib/auth/session";
import { createAgendaBatch } from "@/lib/imports";

export const POST = handle(async (req: Request) => {
  const admin = await requireApiStaff(req, "admin");
  const b = (await req.json()) as { title?: string; meetingDate?: string; substatus?: string; lines?: string; documentId?: string };
  const id = await createAgendaBatch(admin, {
    title: String(b.title ?? ""), meetingDate: String(b.meetingDate ?? ""), substatus: String(b.substatus ?? ""),
    lines: String(b.lines ?? ""), documentId: b.documentId || null,
  });
  return Response.json({ id });
});
