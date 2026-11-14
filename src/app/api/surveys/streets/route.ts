import { handle, requireApiStaff } from "@/lib/auth/session";
import { streetsForSurvey } from "@/lib/surveys";

export const GET = handle(async (req: Request) => {
  await requireApiStaff(req);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json(q.trim().length < 2 ? [] : await streetsForSurvey(q));
});
