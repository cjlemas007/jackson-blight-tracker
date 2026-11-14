/**
 * Nightly sync. Usage:
 *   npm run sync                    all jobs in order
 *   npm run sync -- landroll tax    selected jobs
 *   npm run sync -- --fresh gis_parcels   ignore a partial run and start over
 *   npm run sync -- --list
 * Each job resumes from its last checkpoint if a previous run was interrupted.
 */
import { loadEnv, sanitizeGoogleCredentials } from "./env";
loadEnv();
sanitizeGoogleCredentials();

const { getPool } = await import("@/lib/db");
const { migrate } = await import("../db/migrate");
const { runJob } = await import("./runner");
const { boundariesJob } = await import("./jobs/boundaries");
const { gisParcelsJob } = await import("./jobs/gisParcels");
const { landrollJob } = await import("./jobs/landroll");
const { taxJob } = await import("./jobs/tax");
const { geocodeJob } = await import("./jobs/geocode");
const { rebuildJob } = await import("./jobs/rebuild");

const JOBS = [boundariesJob, gisParcelsJob, landrollJob, taxJob, geocodeJob, rebuildJob];

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const j of JOBS) console.log(`${j.name.padEnd(12)} ${j.description}`);
  process.exit(0);
}
const fresh = args.includes("--fresh");
const names = args.filter((a) => !a.startsWith("--"));
const unknown = names.filter((n) => !JOBS.some((j) => j.name === n));
if (unknown.length) {
  console.error(`unknown job(s): ${unknown.join(", ")}. Use --list.`);
  process.exit(2);
}
const selected = names.length ? JOBS.filter((j) => names.includes(j.name)) : JOBS;

await migrate(process.env.DATABASE_URL!, () => {});
const pool = getPool();
const failed: string[] = [];
for (const job of selected) {
  try {
    await runJob(pool, job, { fresh });
  } catch {
    failed.push(job.name);
    // Keep going: later jobs work from the last good copy of earlier data.
  }
}
await pool.end();
if (failed.length) {
  console.error(`sync finished with failures: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("sync finished");
