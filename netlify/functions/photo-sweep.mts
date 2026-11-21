/**
 * Every 15 minutes, hand anything still queued (a worker that crashed or timed out) back to the
 * photo worker. Scheduled functions get 30 seconds, so this only triggers the background worker.
 */
import type { Config } from "@netlify/functions";

export default async () => {
  const url = Netlify.env.get("PHOTO_WORKER_URL");
  const secret = Netlify.env.get("PHOTO_WORKER_SECRET");
  if (!url || !secret) {
    console.warn("photo-sweep: PHOTO_WORKER_URL / PHOTO_WORKER_SECRET not set");
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ sweep: true }),
  });
  console.log(`photo-sweep: worker answered ${res.status}`);
};

export const config: Config = { schedule: "*/15 * * * *" };
