/**
 * Job runner with checkpoint/resume. Each job keeps a cursor in data.sync_state. If a run
 * dies, the next run of that job resumes from the last committed cursor with the same
 * run_id. Jobs commit page data and the cursor in one transaction, so a page is never
 * half-applied or applied twice.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";

export type Cursor = Record<string, unknown>;

export interface JobContext {
  pool: pg.Pool;
  runId: string;
  startedAt: Date;
  cursor: Cursor;
  /** Persist progress. Pass the transaction client so the checkpoint commits with the page. */
  checkpoint(client: pg.PoolClient | pg.Pool, cursor: Cursor, rowsDelta?: number): Promise<void>;
  stats: Record<string, unknown>;
  log(msg: string): void;
}

export interface Job {
  name: string;
  description: string;
  run(ctx: JobContext): Promise<void>;
}

export async function runJob(pool: pg.Pool, job: Job, opts: { fresh?: boolean } = {}): Promise<void> {
  const prev = (
    await pool.query<{ run_id: string; status: string; cursor: Cursor; started_at: Date }>(
      "SELECT run_id, status, cursor, started_at FROM data.sync_state WHERE job = $1",
      [job.name],
    )
  ).rows[0];

  const resume = !opts.fresh && prev && prev.status !== "done";
  const runId = resume ? prev.run_id : randomUUID();
  const startedAt = resume ? prev.started_at : new Date();
  let cursor: Cursor = resume ? prev.cursor : {};

  await pool.query(
    `INSERT INTO data.sync_state (job, run_id, status, cursor, rows_done, started_at, updated_at)
     VALUES ($1, $2, 'running', $3, 0, $4, now())
     ON CONFLICT (job) DO UPDATE SET run_id = $2, status = 'running', cursor = $3,
       rows_done = CASE WHEN data.sync_state.run_id = $2 THEN data.sync_state.rows_done ELSE 0 END,
       started_at = $4, updated_at = now(), finished_at = NULL, error = NULL`,
    [job.name, runId, cursor, startedAt],
  );

  const t0 = Date.now();
  const log = (msg: string) => console.log(`[${job.name}] ${msg}`);
  log(resume ? `resuming run ${runId.slice(0, 8)} from ${JSON.stringify(cursor)}` : `starting run ${runId.slice(0, 8)}`);

  const ctx: JobContext = {
    pool,
    runId,
    startedAt,
    get cursor() {
      return cursor;
    },
    set cursor(c: Cursor) {
      cursor = c;
    },
    stats: {},
    log,
    async checkpoint(client, next, rowsDelta = 0) {
      cursor = next;
      await client.query(
        "UPDATE data.sync_state SET cursor = $2, rows_done = rows_done + $3, updated_at = now() WHERE job = $1",
        [job.name, next, rowsDelta],
      );
    },
  };

  try {
    await job.run(ctx);
    const { rows } = await pool.query<{ rows_done: number }>(
      `UPDATE data.sync_state SET status = 'done', finished_at = now(), updated_at = now()
       WHERE job = $1 RETURNING rows_done`,
      [job.name],
    );
    await pool.query(
      `INSERT INTO data.sync_runs (job, run_id, status, rows_done, started_at, stats)
       VALUES ($1, $2, 'done', $3, $4, $5)`,
      [job.name, runId, rows[0]?.rows_done ?? 0, startedAt, ctx.stats],
    );
    log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s ${JSON.stringify(ctx.stats)}`);
  } catch (e) {
    const msg = (e as Error).stack ?? String(e);
    await pool.query(
      "UPDATE data.sync_state SET status = 'failed', error = $2, updated_at = now() WHERE job = $1",
      [job.name, msg],
    );
    await pool.query(
      `INSERT INTO data.sync_runs (job, run_id, status, started_at, error, stats)
       VALUES ($1, $2, 'failed', $3, $4, $5)`,
      [job.name, runId, startedAt, msg, ctx.stats],
    );
    log(`FAILED (will resume from last checkpoint on next run): ${(e as Error).message}`);
    throw e;
  }
}

/** Run fn inside a transaction on a dedicated client. */
export async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** fetch with retries and backoff for flaky public endpoints. */
export async function fetchJson<T = unknown>(url: string, init?: RequestInit, tries = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 200)}`);
      const body = (await res.json()) as T & { error?: { message?: string } };
      if (body && typeof body === "object" && "error" in body && body.error) {
        throw new Error(`ArcGIS error: ${JSON.stringify(body.error).slice(0, 300)}`);
      }
      return body;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
