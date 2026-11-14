import { handle, requireApiStaff } from "@/lib/auth/session";
import { createDraft, WorkflowError } from "@/lib/submissions";
import { COUNTY } from "@/config";

export const POST = handle(async (req: Request) => {
  const staff = await requireApiStaff(req);
  const { parcelId } = (await req.json()) as { parcelId?: string };
  try {
    return Response.json({ id: await createDraft(staff, COUNTY, String(parcelId ?? "")) });
  } catch (e) {
    if (e instanceof WorkflowError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
