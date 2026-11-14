/**
 * Applies SQL migrations in order. Data-layer migrations (db/migrations/data, 0xxx) hold
 * synced source data; logic-layer migrations (db/migrations/logic, 1xxx) hold the parcel
 * lifecycle and derived assignments. They are kept apart so each can ship on its own.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnv } from "../sync/env";

const DIRS = ["data", "logic"] as const;

export async function migrate(connectionString: string, log = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM public.schema_migrations")).rows.map((r) => r.name),
    );
    const root = path.join(import.meta.dirname, "migrations");
    const files = DIRS.filter((d) => existsSync(path.join(root, d))).flatMap((d) =>
      readdirSync(path.join(root, d))
        .filter((f) => f.endsWith(".sql"))
        .map((f) => ({ name: `${d}/${f}`, file: path.join(root, d, f) })),
    ).sort((a, b) => path.basename(a.name).localeCompare(path.basename(b.name)));
    for (const m of files) {
      if (done.has(m.name)) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(m.file, "utf8"));
        await client.query("INSERT INTO public.schema_migrations(name) VALUES ($1)", [m.name]);
        await client.query("COMMIT");
        applied.push(m.name);
        log(`applied ${m.name}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${m.name} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  migrate(process.env.DATABASE_URL!)
    .then((a) => console.log(a.length ? `${a.length} migration(s) applied` : "up to date"))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
