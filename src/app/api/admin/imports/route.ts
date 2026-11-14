import { handle, requireApiStaff } from "@/lib/auth/session";
import { createCsvBatch, type ImportKind } from "@/lib/imports";

export const POST = handle(async (req: Request) => {
  const admin = await requireApiStaff(req, "admin");
  const b = (await req.json()) as { kind?: ImportKind; title?: string; documentId?: string };
  const id = await createCsvBatch(admin, { kind: b.kind as ImportKind, title: String(b.title ?? ""), documentId: String(b.documentId ?? "") });
  return Response.json({ id });
});
