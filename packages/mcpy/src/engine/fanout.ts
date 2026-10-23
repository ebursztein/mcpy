/**
 * Thorough mode asks several providers at once. Waiting for the slowest one
 * made answers as slow as the worst index (seen live: 55 s because one paper
 * index took that long). Instead, once the first provider answers, the
 * others get a grace period; whatever has not answered by then is left out.
 */

export type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown }
  /** Still running when the grace period ended. */
  | { status: "late" };

export async function settleWithGrace<T>(tasks: Promise<T>[], graceMs: number): Promise<Settled<T>[]> {
  const results: (Settled<T> | undefined)[] = tasks.map(() => undefined);
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  let pending = tasks.length;
  let grace: ReturnType<typeof setTimeout> | undefined;

  tasks.forEach((task, i) => {
    task
      .then(
        (value) => {
          results[i] = { status: "fulfilled", value };
          grace ??= setTimeout(finish, graceMs);
        },
        (reason: unknown) => {
          results[i] = { status: "rejected", reason };
        },
      )
      .finally(() => {
        if (--pending === 0) finish();
      });
  });
  if (tasks.length === 0) finish();

  await done;
  if (grace) clearTimeout(grace);
  // Snapshot now: late tasks may still settle later, but their results are not used.
  return results.map((r) => r ?? { status: "late" as const });
}
