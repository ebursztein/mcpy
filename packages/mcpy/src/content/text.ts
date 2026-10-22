import { RE2JS } from "re2js";
import { ErrorCode, GrepMode } from "../enums.js";
import { McpyError } from "../errors.js";

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

export const MAX_PATTERN_LENGTH = 500;
/** Printed width around a match; long lines (minified HTML) are windowed, never skipped. */
const MATCH_WINDOW_BEFORE = 300;
const MATCH_WINDOW_AFTER = 700;
const CONTEXT_LINE_MAX = 300;

/** Finds the first match in a line, or -1. */
type Matcher = (line: string) => number;

/**
 * Regex patterns run on RE2 (re2js): linear time in the input, so no
 * pattern can stall the server (no catastrophic backtracking). RE2 does
 * not support lookaround or backreferences; those are rejected up front.
 */
function compile(pattern: string, mode: GrepMode): Matcher {
  if (pattern.length > MAX_PATTERN_LENGTH) throw new McpyError(ErrorCode.InvalidInput, `pattern longer than ${MAX_PATTERN_LENGTH} characters`);
  if (mode === GrepMode.Literal) {
    const needle = pattern.toLowerCase();
    return (line) => line.toLowerCase().indexOf(needle);
  }
  let re: RE2JS;
  try {
    re = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new McpyError(ErrorCode.InvalidInput, `invalid regex (RE2 syntax; no lookaround or backreferences): ${detail}`);
  }
  return (line) => {
    const m = re.matcher(line);
    return m.find() ? m.start() : -1;
  };
}

function window(line: string, at: number): string {
  if (line.length <= MATCH_WINDOW_BEFORE + MATCH_WINDOW_AFTER) return line;
  const from = Math.max(0, at - MATCH_WINDOW_BEFORE);
  const to = Math.min(line.length, at + MATCH_WINDOW_AFTER);
  return `${from > 0 ? "…" : ""}${line.slice(from, to)}${to < line.length ? "…" : ""}`;
}

/** Case-insensitive search over lines (regex or literal), with surrounding context. */
export function grepLines(lines: string[], pattern: string, context: number, maxMatches: number, mode: GrepMode = GrepMode.Regex): GrepResult {
  const find = compile(pattern, mode);

  const hits = new Map<number, number>(); // line index -> match offset
  let capped = false;
  for (let i = 0; i < lines.length; i++) {
    const at = find(lines[i]);
    if (at < 0) continue;
    if (hits.size === maxMatches) {
      capped = true;
      break;
    }
    hits.set(i, at);
  }

  // Merge overlapping context windows into blocks.
  const blocks: [number, number][] = [];
  for (const i of hits.keys()) {
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length - 1, i + context);
    const last = blocks.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else blocks.push([from, to]);
  }

  const output = blocks
    .map(([from, to]) => {
      const out: string[] = [];
      for (let i = from; i <= to; i++) {
        const at = hits.get(i);
        out.push(at === undefined ? `  ${i + 1}: ${clip(lines[i], CONTEXT_LINE_MAX)}` : `> ${i + 1}: ${window(lines[i], at)}`);
      }
      return out.join("\n");
    })
    .join("\n--\n");

  return { output, matches: hits.size, capped };
}

/** Shorten to at most n characters, marking the cut with an ellipsis. */
export function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}
