/**
 * Reading application state embedded in pages: Next.js data, assigned
 * globals (window.__INITIAL_STATE__ = {...}), JSON string assignments, the
 * streamed Next.js flight data, and plain JSON bodies. No regex ever spans a
 * JSON value: values are cut by matching brackets, so nested objects and
 * strings containing "</script>" or "};" cannot end them early.
 */

/** A key, an array index, or {field: value} to pick the first array element that matches. */
export type Segment = string | number | Readonly<Record<string, string | number>>;

export function pick(value: unknown, path: readonly Segment[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (current == null) return undefined;
    if (typeof segment === "object") {
      if (!Array.isArray(current)) return undefined;
      const [field, wanted] = Object.entries(segment)[0] ?? [];
      current = current.find((e) => e && typeof e === "object" && (e as Record<string, unknown>)[field as string] === wanted);
    } else {
      current = (current as Record<string | number, unknown>)[segment];
    }
  }
  return current ?? undefined;
}

export function parseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The JSON value starting at text[start] ({ or [ or "), cut at its matching end. */
export function balancedJson(text: string, start: number): string | undefined {
  const open = text[start];
  if (open === '"') {
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === '"') return text.slice(start, i + 1);
    }
    return undefined;
  }
  if (open !== "{" && open !== "[") return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** The body of <script id="..."> (e.g. __NEXT_DATA__), parsed. */
export function scriptById(html: string, id: string): unknown {
  const tag = new RegExp(`<script[^>]*\\bid=["']${id}["'][^>]*>`, "i").exec(html);
  if (!tag) return undefined;
  const start = tag.index + tag[0].length;
  const end = html.indexOf("</script>", start);
  return parseJson(end < 0 ? undefined : html.slice(start, end).trim());
}

export const nextData = (html: string): unknown => scriptById(html, "__NEXT_DATA__");

/**
 * The value assigned to a global: `window.NAME = {...}`, `NAME = "json text"`.
 * A string value holding JSON (OLX's prerendered state) is parsed twice.
 */
export function assigned(html: string, name: string): unknown {
  const re = new RegExp(`(?:window\\.)?${name.replace(/[.$]/g, "\\$&")}\\s*=\\s*`, "g");
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const raw = balancedJson(html, m.index + m[0].length);
    if (!raw) continue;
    const value = parseJson(raw);
    if (typeof value === "string") {
      const inner = parseJson(value);
      if (inner !== undefined) return inner;
    } else if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * The Next.js app-router flight data (self.__next_f.push([1,"..."])), joined
 * into one string. Rows are then found inside it with balancedJson().
 */
export function flight(html: string): string {
  const parts: string[] = [];
  const re = /self\.__next_f\.push\(\[\s*1\s*,\s*/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const raw = balancedJson(html, m.index + m[0].length);
    const value = raw ? parseJson(raw) : undefined;
    if (typeof value === "string") parts.push(value);
  }
  return parts.join("");
}

/** Every JSON object in `text` that starts with `marker` (e.g. '{"listId":'), parsed. */
export function objectsStartingWith(text: string, marker: string, limit = 200): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let at = text.indexOf(marker); at >= 0 && out.length < limit; at = text.indexOf(marker, at + 1)) {
    const raw = balancedJson(text, at);
    const value = raw ? parseJson(raw) : undefined;
    if (value && typeof value === "object" && !Array.isArray(value)) out.push(value as Record<string, unknown>);
  }
  return out;
}

/** The whole body as JSON, for site APIs. */
export const bodyJson = (content: string): unknown => parseJson(content.trim());

/** Walks any JSON value and returns every object for which `test` holds (depth-first, capped). */
export function findObjects(value: unknown, test: (o: Record<string, unknown>) => boolean, limit = 500): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const stack: unknown[] = [value];
  while (stack.length && out.length < limit) {
    const v = stack.pop();
    if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (test(o)) out.push(o);
      else for (const k of Object.keys(o).reverse()) stack.push(o[k]);
    }
  }
  return out;
}
