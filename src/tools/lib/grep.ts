export interface GrepResult {
  matches: number;
  capped: boolean;
  output: string;
}

export function grepLines(
  lines: string[],
  pattern: string,
  contextLines: number,
  maxMatches: number,
): GrepResult {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }

  const matchIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      matchIndices.push(i);
      if (matchIndices.length >= maxMatches) break;
    }
  }

  if (matchIndices.length === 0) {
    return { matches: 0, capped: false, output: "" };
  }

  const outputLines: string[] = [];
  let lastEnd = -1;

  for (const idx of matchIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(lines.length - 1, idx + contextLines);

    if (start > lastEnd + 1) {
      outputLines.push("...");
    }

    for (let i = Math.max(start, lastEnd + 1); i <= end; i++) {
      const prefix = i === idx ? ">>>" : "   ";
      const lineNum = String(i + 1).padStart(4);
      outputLines.push(`${prefix} ${lineNum} | ${lines[i]}`);
    }
    lastEnd = end;
  }

  return {
    matches: matchIndices.length,
    capped: matchIndices.length >= maxMatches,
    output: outputLines.join("\n"),
  };
}
