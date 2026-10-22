/** Character-window pagination so large pages fit an LLM context. */
export function paginate(text: string, start: number, maxLength: number) {
  const chunk = text.slice(start, start + maxLength);
  const end = start + chunk.length;
  return { chunk, total: text.length, end, hasMore: end < text.length };
}

export interface GrepResult {
  output: string;
  matches: number;
  capped: boolean;
}

const MAX_PATTERN_LENGTH = 500;
// Bound per-line work so a pathological regex cannot burn the CPU budget.
const MAX_LINE_LENGTH = 5_000;

/** Case-insensitive regex search over lines, with surrounding context. */
export function grepLines(lines: string[], pattern: string, context: number, maxMatches: number): GrepResult {
  if (pattern.length > MAX_PATTERN_LENGTH) throw new Error(`pattern longer than ${MAX_PATTERN_LENGTH} characters`);
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch (err) {
    throw new Error(`invalid regex: ${err instanceof Error ? err.message : String(err)}`);
  }

  const hits: number[] = [];
  let capped = false;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i].slice(0, MAX_LINE_LENGTH))) {
      if (hits.length === maxMatches) {
        capped = true;
        break;
      }
      hits.push(i);
    }
  }

  // Merge overlapping context windows into blocks.
  const blocks: [number, number][] = [];
  for (const i of hits) {
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length - 1, i + context);
    const last = blocks.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else blocks.push([from, to]);
  }

  const hitSet = new Set(hits);
  const output = blocks
    .map(([from, to]) => {
      const out: string[] = [];
      for (let i = from; i <= to; i++) out.push(`${hitSet.has(i) ? ">" : " "} ${i + 1}: ${lines[i]}`);
      return out.join("\n");
    })
    .join("\n--\n");

  return { output, matches: hits.length, capped };
}
