/**
 * fetch_batch over any fetch: the SDK runs it over its own, the server over
 * its recording one, so each request is a fetch of its own (cache, spending
 * cap, usage row) whoever runs the batch. A request that fails is answered
 * with its error; the others are not affected.
 *
 * Every request starts at once, so their cache lookups reach KV together and
 * share one bulk get, and what the cache answers is answered right away. Only
 * a request that must call a site waits, for a slot from the batch's pacer:
 * at most FETCH_BATCH_CONCURRENCY in flight, the Worker runtime's own limit
 * (it starts at most 6 subrequests at once and queues the rest, their
 * timeouts running), and FETCH_BATCH_PER_SITE to any one host, so a batch
 * never weighs on a site more than a browser does. Identical reads are
 * fetched once; every write is sent. A request still waiting at the batch's
 * deadline is answered timeout without being sent.
 */

import { CacheStatus, ErrorCode } from "../enums.js";
import { McpyError, toMcpyError } from "../errors.js";
import type { Admit } from "../engine/engine.js";
import { isSafeMethod } from "../http/methods.js";
import { FetchBatchInputSchema, type FetchBatchEntry, type FetchBatchRequest, type FetchBatchResult } from "../schemas-batch.js";
import type { ErrorBody, FetchInput, FetchResult } from "../schemas.js";

/** Requests of one batch in flight at once: what a Worker invocation starts at once. */
export const FETCH_BATCH_CONCURRENCY = 6;
/** Requests to one host in flight at once: under the 6 a browser opens per host, and fair to the batch's other sites. */
export const FETCH_BATCH_PER_SITE = 4;
/** A request still waiting to call its site this long after the batch began is answered timeout, unsent. */
export const FETCH_BATCH_DEADLINE_MS = 25_000;

export interface FetchBatchOptions {
  deadlineMs?: number;
}

/** A fetch that waits for `admit` before it calls a site. */
type Fetch = (input: FetchInput, admit: Admit) => Promise<FetchResult>;
/** A request's answer before its id is put back on it. */
type Answer = { result: FetchResult } | ErrorBody;

/** One distinct request of the batch, and the positions it answers. */
interface Job {
  request: FetchInput;
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
    const job = { request, positions: [position] };
    jobs.push(job);
    if (key !== undefined) reads.set(key, job);
  });
  return jobs;
}

const notSent = () => new McpyError(ErrorCode.Timeout, "not sent: the batch ran out of time; send it again");

/** Hands out the batch's slots to call sites, in the order asked: at most 6 at once, 4 per host, none past the deadline. */
class SitePacer {
  private readonly waiting: { site: string; admit: (release: () => void) => void; refuse: (err: McpyError) => void }[] = [];
  private readonly perSite = new Map<string, number>();
  private inFlight = 0;
  private closed = false;
  private readonly timer: ReturnType<typeof setTimeout>;
  /** Requests refused at the deadline, never sent. */
  expired = 0;

  constructor(deadlineAt: number) {
    this.timer = setTimeout(() => this.expire(), Math.max(0, deadlineAt - Date.now()));
  }

  readonly admit: Admit = (site) =>
    new Promise((admit, refuse) => {
      if (this.closed) return void (this.expired++, refuse(notSent()));
      this.waiting.push({ site, admit, refuse });
      this.pump();
    });

  /** Stop the deadline's timer once every request has its answer. */
  done(): void {
    clearTimeout(this.timer);
  }

  private pump(): void {
    for (let i = 0; i < this.waiting.length && this.inFlight < FETCH_BATCH_CONCURRENCY; ) {
      const { site, admit } = this.waiting[i]!;
      if ((this.perSite.get(site) ?? 0) >= FETCH_BATCH_PER_SITE) {
        i++;
        continue;
      }
      this.waiting.splice(i, 1);
      this.inFlight++;
      this.perSite.set(site, (this.perSite.get(site) ?? 0) + 1);
      let released = false;
      admit(() => {
        if (released) return;
        released = true;
        this.inFlight--;
        this.perSite.set(site, this.perSite.get(site)! - 1);
        this.pump();
      });
    }
  }

  private expire(): void {
    this.closed = true;
    for (const { refuse } of this.waiting.splice(0)) {
      this.expired++;
      refuse(notSent());
    }
  }
}

export async function runFetchBatch(fetch: Fetch, raw: unknown, options: FetchBatchOptions = {}): Promise<FetchBatchResult> {
  const startedAt = Date.now();
  const parsed = FetchBatchInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues);
  const requests = parsed.data.requests;
  const jobs = jobsOf(requests);
  const answers = new Array<Answer>(requests.length);
  const answer = (job: Job, entry: Answer) => job.positions.forEach((p) => (answers[p] = entry));
  const pacer = new SitePacer(startedAt + (options.deadlineMs ?? FETCH_BATCH_DEADLINE_MS));
  try {
    await Promise.all(
      jobs.map(async (job) => {
        try {
          answer(job, { result: await fetch(job.request, pacer.admit) });
        } catch (err) {
          answer(job, toMcpyError(err).toJSON());
        }
      }),
    );
  } finally {
    pacer.done();
  }
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
      fetched: jobs.length - pacer.expired,
      deduplicated: requests.length - jobs.length,
      cache_hits: results.filter((r) => "result" in r && r.result.meta.cache === CacheStatus.Hit).length,
      failed: results.filter((r) => "error" in r).length,
    },
  };
}
