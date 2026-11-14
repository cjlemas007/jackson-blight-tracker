import { handle, requireApiStaff } from "@/lib/auth/session";
import { createDocumentSlot } from "@/lib/documents";
import { storage } from "@/lib/storage";

export const POST = handle(async (req: Request) => {
  const admin = await requireApiStaff(req, "admin");
  const b = (await req.json()) as { name?: string; mime?: string; bytes?: number; public?: boolean; title?: string; date?: string };
  const slot = await createDocumentSlot(admin, {
    name: String(b.name ?? "document"), mime: String(b.mime ?? ""), bytes: Number(b.bytes ?? 0),
    public: !!b.public, title: b.title, date: b.date || null,
  });
  return Response.json({ documentId: slot.documentId, upload: await storage().uploadTarget(slot.key, String(b.mime)) });
});
