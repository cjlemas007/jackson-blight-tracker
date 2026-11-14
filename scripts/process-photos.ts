/** Process any photos still queued (e.g. after a dev-server restart). */
import { loadEnv } from "../sync/env";
loadEnv();
const { getPool } = await import("../src/lib/db");
const { processAllQueued } = await import("../src/lib/photos/process");
const n = await processAllQueued();
console.log(`processed ${n} submission(s)`);
await getPool().end();
