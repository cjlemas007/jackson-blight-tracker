import pg from "pg";
import { loadEnv } from "../../sync/env";
import { migrate } from "../../db/migrate";

loadEnv();

/** Fresh schema in the blight_test database (never the synced database). */
export async function freshTestDb(): Promise<pg.Pool> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/blight_test/.test(url)) throw new Error("TEST_DATABASE_URL must point at the blight_test database");
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(
    "DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS data CASCADE; DROP TABLE IF EXISTS public.schema_migrations",
  );
  await admin.end();
  await migrate(url, () => {});
  return new pg.Pool({ connectionString: url });
}
