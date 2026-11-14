import { BigQuery } from "@google-cloud/bigquery";
import type { JobContext } from "./runner";

export function bq(): BigQuery {
  return new BigQuery({ projectId: process.env.BQ_PROJECT ?? "wlbt-projects" });
}

export function table(name: string): string {
  const project = process.env.BQ_PROJECT ?? "wlbt-projects";
  const dataset = process.env.BQ_DATASET ?? "property_tax";
  return `\`${project}.${dataset}.${name}\``;
}

export interface BqCursor {
  jobId?: string;
  location?: string;
  pageToken?: string | null;
  pages?: number;
  [k: string]: unknown;
}

/**
 * Runs a query once and pages through its results, checkpointing the BigQuery job id and
 * page token so a crash resumes at the next unprocessed page. Query results live 24h; if
 * they've expired the query is re-run from the first page (page handlers are idempotent upserts).
 */
export async function pageQuery<R>(
  ctx: JobContext,
  sql: string,
  params: Record<string, unknown>,
  /** Must persist `nextCursor` via ctx.checkpoint in the same transaction as the page's writes. */
  handlePage: (rows: R[], nextCursor: BqCursor) => Promise<void>,
  pageSize = 5000,
): Promise<void> {
  const client = bq();
  let cur = ctx.cursor as BqCursor;
  if (cur.pageToken === null) return; // already consumed all pages in this run

  const startQuery = async () => {
    const [job] = await client.createQueryJob({ query: sql, params, useLegacySql: false });
    const location = job.metadata?.jobReference?.location ?? "US";
    ctx.log(`BigQuery job ${job.id} (${location})`);
    cur = { ...cur, jobId: job.id!, location, pageToken: undefined, pages: 0 };
    await ctx.checkpoint(ctx.pool, cur);
  };
  if (!cur.jobId) await startQuery();

  for (;;) {
    let rows: R[];
    let next: { pageToken?: string } | null | undefined;
    try {
      const job = client.job(cur.jobId!, { location: cur.location });
      [rows, next] = (await job.getQueryResults({
        maxResults: pageSize,
        pageToken: cur.pageToken ?? undefined,
        autoPaginate: false,
        timeoutMs: 600_000,
      })) as unknown as [R[], { pageToken?: string } | null];
    } catch (e) {
      const msg = (e as Error).message;
      if (/not found|expired|invalid.*token/i.test(msg) && cur.pageToken) {
        ctx.log(`query results gone (${msg}); re-running query`);
        await startQuery();
        continue;
      }
      throw e;
    }
    const nextToken = next?.pageToken ?? null;
    const nextCursor: BqCursor = { ...cur, pageToken: nextToken, pages: (cur.pages ?? 0) + 1 };
    await handlePage(rows, nextCursor);
    cur = nextCursor;
    if (!nextToken) break;
  }
}
