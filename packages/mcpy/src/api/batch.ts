/**
 * fetch_batch over any fetch: the SDK runs it over its own, the server over
 * its recording one, so each request is a fetch of its own (cache, spending
 * cap, usage row) whoever runs the batch. A request that fails is answered
 * with its error; the others are not affected.
 *
 * Pacing: at most FETCH_BATCH_CONCURRENCY requests in flight, the Worker
 * runtime's own limit (it starts at most 6 subrequests at once and queues the
 * rest, their timeouts running), and FETCH_BATCH_PER_SITE to any one host, so
 * a batch never weighs on a site more than a browser does. Identical reads are
 * fetched once; every write is sent. A request not started by the batch's
 * deadline is answered timeout without being sent.
 */

import { CacheStatus, ErrorCode } from "../enums.js";
import { McpyError, toMcpyError } from "../errors.js";
import { isSafeMethod } from "../http/methods.js";
import { FetchBatchInputSchema, type FetchBatchEntry, type FetchBatchRequest, type FetchBatchResult } from "../schemas-batch.js";
import type { ErrorBody, FetchInput, FetchResult } from "../schemas.js";

/** Requests of one batch in flight at once: what a Worker invocation starts at once. */
export const FETCH_BATCH_CONCURRENCY = 6;
/** Requests to one host in flight at once: under the 6 a browser opens per host, and fair to the batch's other sites. */
export const FETCH_BATCH_PER_SITE = 4;
/** A request not started this long after the batch began is answered timeout, unsent. */
export const FETCH_BATCH_DEADLINE_MS = 25_000;

export interface FetchBatchOptions {
  deadlineMs?: number;
}

type Fetch = (input: FetchInput) => Promise<FetchResult>;
/** A request's answer before its id is put back on it. */
type Answer = { result: FetchResult } | ErrorBody;

/** One distinct request of the batch, and the positions it answers. */
interface Job {
  request: FetchInput;
  host: string;
  positions: number[];
}

function invalid(issues: { path: PropertyKey[]; message: string }[]): McpyError {
  return new McpyError(
    ErrorCode.InvalidInput,
    "invalid input",
    issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`),
  );
}

/** Identical reads share one job; a write is always its own. */
function jobsOf(requests: readonly FetchBatchRequest[]): Job[] {
  const jobs: Job[] = [];
  const reads = new Map<string, Job>();
  requests.forEach(({ id: _id, ...request }, position) => {
    const key = isSafeMethod(request.method) ? JSON.stringify(request) : undefined;
    const same = key === undefined ? undefined : reads.get(key);
    if (same) return void same.positions.push(position);
    const job = { request, host: new URL(request.url).host, positions: [position] };
    jobs.push(job);
    if (key !== undefined) reads.set(key, job);
  });
  return jobs;
}

/** Runs every job, at most `overall` at once and `perSite` per host, starting none past `deadlineAt`. */
async function schedule(jobs: Job[], run: (job: Job) => Promise<void>, expire: (job: Job) => void, deadlineAt: number): Promise<void> {
  const waiting = [...jobs];
  const perHost = new Map<string, number>();
  let inFlight = 0;
  await new Promise<void>((done) => {
    const pump = () => {
      if (Date.now() >= deadlineAt) waiting.splice(0).forEach(expire);
      for (let i = 0; i < waiting.length && inFlight < FETCH_BATCH_CONCURRENCY; ) {
        const job = waiting[i]!;
        if ((perHost.get(job.host) ?? 0) >= FETCH_BATCH_PER_SITE) {
          i++;
          continue;
        }
        waiting.splice(i, 1);
        inFlight++;
        perHost.set(job.host, (perHost.get(job.host) ?? 0) + 1);
        void run(job).finally(() => {
          inFlight--;
          perHost.set(job.host, perHost.get(job.host)! - 1);
          pump();
        });
      }
      if (inFlight === 0 && waiting.length === 0) done();
    };
    pump();
  });
}

export async function runFetchBatch(fetch: Fetch, raw: unknown, options: FetchBatchOptions = {}): Promise<FetchBatchResult> {
  const startedAt = Date.now();
  const parsed = FetchBatchInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues);
  const requests = parsed.data.requests;
  const jobs = jobsOf(requests);
  const answers = new Array<Answer>(requests.length);
  const answer = (job: Job, entry: Answer) => job.positions.forEach((p) => (answers[p] = entry));
  let fetched = 0;
  await schedule(
    jobs,
    async (job) => {
      fetched++;
      try {
        answer(job, { result: await fetch(job.request) });
      } catch (err) {
        answer(job, toMcpyError(err).toJSON());
      }
    },
    (job) => answer(job, new McpyError(ErrorCode.Timeout, "not sent: the batch ran out of time; send it again").toJSON()),
    startedAt + (options.deadlineMs ?? FETCH_BATCH_DEADLINE_MS),
  );
  const results = answers.map((entry, i) => (requests[i]!.id === undefined ? entry : { id: requests[i]!.id, ...entry })) as FetchBatchEntry[];
  // A failed request's cost is not in any answer: what it spent is in the cap and the usage log. A shared answer is paid once.
  const costUsd = jobs.reduce((sum, job) => {
    const entry = answers[job.positions[0]!]!;
    return sum + ("result" in entry ? (entry.result.meta.cost_usd ?? 0) : 0);
  }, 0);
  return {
    results,
    meta: {
      latency_ms: Date.now() - startedAt,
      cost_usd: Math.round(costUsd * 1e6) / 1e6,
      fetched,
      deduplicated: requests.length - jobs.length,
      cache_hits: results.filter((r) => "result" in r && r.result.meta.cache === CacheStatus.Hit).length,
      failed: results.filter((r) => "error" in r).length,
    },
  };
}
