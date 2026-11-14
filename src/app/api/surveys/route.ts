import { handle, requireApiStaff } from "@/lib/auth/session";
import { startSurvey, type ScopeKind } from "@/lib/surveys";

export const POST = handle(async (req: Request) => {
  const staff = await requireApiStaff(req);
  const b = (await req.json()) as { kind?: ScopeKind; value?: string };
  return Response.json({ id: await startSurvey(staff, { kind: b.kind as ScopeKind, value: String(b.value ?? "") }) });
});
