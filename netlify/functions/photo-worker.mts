/**
 * Photo worker (background function, 15-minute limit). The submit route POSTs
 * { submissionId } here after a staff member sends in photos; the sweeper posts { sweep: true }.
 * Detects faces and plates, writes the EXIF-stripped, blurred copy, then moves the submission
 * into the review queue. Authenticated with a shared secret (PHOTO_WORKER_SECRET).
 */
import type { Config } from "@netlify/functions";
import { processAllQueued, processSubmission } from "../../src/lib/photos/process";

export default async (req: Request) => {
  const secret = Netlify.env.get("PHOTO_WORKER_SECRET");
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    console.warn("photo-worker: rejected request without a valid secret");
    return;
  }
  const body = (await req.json().catch(() => ({}))) as { submissionId?: string; sweep?: boolean };
  if (body.sweep) {
    const n = await processAllQueued();
    console.log(`photo-worker: swept ${n} submission(s)`);
  } else if (typeof body.submissionId === "string" && /^[0-9a-f-]{36}$/i.test(body.submissionId)) {
    await processSubmission(body.submissionId);
    console.log(`photo-worker: processed ${body.submissionId}`);
  } else {
    console.warn("photo-worker: no submissionId");
  }
};

export const config: Config = { background: true };
