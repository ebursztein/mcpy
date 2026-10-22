import { ContentKind } from "../enums.js";
import { isHtml, isMarkdown } from "../http/url.js";

/** Classify a response by its content type (pages default to HTML). */
export function contentKindOf(contentType: string): ContentKind {
  if (!contentType || isHtml(contentType)) return ContentKind.Html;
  if (isMarkdown(contentType)) return ContentKind.Markdown;
  if (/json/i.test(contentType)) return ContentKind.Json;
  return ContentKind.Text;
}
