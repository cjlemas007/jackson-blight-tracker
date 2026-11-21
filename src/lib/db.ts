import pg from "pg";

// numeric -> JS number, bigint count -> number. Values here are dollar amounts and counts
// well inside double precision.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date -> 'YYYY-MM-DD' string (avoid timezone shifts on plain dates)
pg.types.setTypeParser(1082, (v) => v);

const globalForPool = globalThis as unknown as { __blightPool?: pg.Pool };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return url;
}

export function getPool(url = databaseUrl()): pg.Pool {
  if (!globalForPool.__blightPool) {
    // Serverless functions each hold their own pool, so keep it small there (DB_POOL_MAX=2 on
    // Netlify) and connect through Supabase's transaction pooler.
    const max = Number(process.env.DB_POOL_MAX) || 8;
    globalForPool.__blightPool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 10_000 });
  }
  return globalForPool.__blightPool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}
