import "server-only";
import { after } from "next/server";
import { processSubmission } from "./process";

/**
 * Hand a submission's photos to the processor without making the submitter wait.
 * Production (Netlify): POST to the background function at PHOTO_WORKER_URL (15-min limit).
 * Development: run after the response is sent. `npm run photos:process` sweeps anything stuck.
 */
export function enqueueProcessing(submissionId: string) {
  const worker = process.env.PHOTO_WORKER_URL;
  after(async () => {
    if (worker) {
      await fetch(worker, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PHOTO_WORKER_SECRET ?? ""}` },
        body: JSON.stringify({ submissionId }),
      });
    } else {
      await processSubmission(submissionId);
    }
  });
}
