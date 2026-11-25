/**
 * Reading a block reward off the chain at many points with few requests. A
 * reward is a step function of height: it holds for weeks (Kaspa: a month,
 * Dash: a year) and only falls. So when two points read the same, every point
 * between them does too, and only a span whose ends differ is split. A window
 * of n points with s steps costs about 2 + 2·s·log2(n) reads, not n.
 */

/** Values at each point, in order; undefined where unread (the budget ran out, or a read failed). */
export async function fillSteps<P>(
  points: readonly P[],
  read: (point: P) => Promise<number | undefined>,
  options: { maxReads: number; same?: (a: number, b: number) => boolean },
): Promise<(number | undefined)[]> {
  const same = options.same ?? ((a, b) => a === b);
  const out: (number | undefined)[] = new Array(points.length).fill(undefined);
  let reads = 0;
  const at = async (i: number) => {
    if (reads >= options.maxReads) return undefined;
    reads++;
    return read(points[i]).catch(() => undefined);
  };
  if (!points.length) return out;
  const last = points.length - 1;
  const [first, end] = await Promise.all([at(0), last ? at(last) : undefined]);
  out[0] = first;
  if (!last) return out;
  out[last] = end;

  const split = async (lo: number, hi: number): Promise<void> => {
    const [a, b] = [out[lo], out[hi]];
    if (a === undefined || b === undefined) return; // an unread end: the span stays unknown
    if (same(a, b)) {
      for (let i = lo + 1; i < hi; i++) out[i] = a;
      return;
    }
    if (hi - lo < 2) return;
    const mid = (lo + hi) >> 1;
    out[mid] = await at(mid);
    await Promise.all([split(lo, mid), split(mid, hi)]);
  };
  await split(0, last);
  return out;
}
