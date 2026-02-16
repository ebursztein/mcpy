export interface PaginateResult {
  chunk: string;
  total: number;
  hasMore: boolean;
}

export function paginate(content: string, startIndex: number, maxLength: number): PaginateResult {
  const total = content.length;
  const chunk = content.slice(startIndex, startIndex + maxLength);
  const hasMore = startIndex + maxLength < total;
  return { chunk, total, hasMore };
}

export function paginationHeader(startIndex: number, chunk: string, total: number, hasMore: boolean, maxLength: number): string {
  return [
    `Total length: ${total} chars`,
    `Showing: ${startIndex}-${startIndex + chunk.length}`,
    hasMore ? `Has more: true (use start_index=${startIndex + maxLength} to continue)` : "Has more: false",
    "---",
  ].join("\n");
}
