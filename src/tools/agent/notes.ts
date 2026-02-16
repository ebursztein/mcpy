import { z } from "zod";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, readdirSync, unlinkSync, existsSync } from "fs";
import type { ToolDefinition, ToolContext, GroupDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";
import { paginate, paginationHeader } from "../lib/paginate.ts";
import { grepLines } from "../lib/grep.ts";

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export const notesGroup: GroupDefinition = {
  id: "notes",
  category: "agent",
  label: "Notes",
  description: "Persistent markdown notes with tags, search, and grep",
  requiresConfig: false,
  enabledByDefault: true,
  settingsFields: [
    {
      key: "notes.directory",
      label: "Notes Directory",
      type: "text",
      placeholder: "~/.mcpy/notes/",
      gridSpan: 2,
    },
  ],
};

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface NoteMeta {
  id: string;
  title: string;
  tags: string[];
  description: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

interface NoteFile {
  meta: NoteMeta;
  content: string;
  filePath: string;
}

function randomHexId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getNotesDir(context: ToolContext): string {
  const custom = (context.settings as Record<string, unknown>).notes as
    | { directory?: string }
    | undefined;
  if (custom?.directory) {
    const dir = custom.directory;
    return dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
  }
  return join(context.dataDir, "notes");
}

function ensureNotesDir(context: ToolContext): string {
  const dir = getNotesDir(context);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function noteFileName(id: string, title: string): string {
  const slug = slugify(title);
  return slug ? `${id}-${slug}.md` : `${id}.md`;
}

// Simple frontmatter parser -- no YAML dependency needed.
// We write values in a deterministic format so parsing is straightforward.
function parseNote(filePath: string): NoteFile | null {
  const file = Bun.file(filePath);
  // Synchronous read via readFileSync for simplicity in list operations
  let raw: string;
  try {
    raw = require("fs").readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return null;

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;

  // Parse frontmatter key-value pairs
  const meta: NoteMeta = {
    id: "",
    title: "",
    tags: [],
    description: "",
    pinned: false,
    created_at: "",
    updated_at: "",
  };

  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    switch (key) {
      case "id":
        meta.id = val;
        break;
      case "title":
        meta.title = tryJsonParse(val, val);
        break;
      case "tags":
        try {
          meta.tags = JSON.parse(val);
        } catch {
          meta.tags = [];
        }
        break;
      case "description":
        meta.description = tryJsonParse(val, val);
        break;
      case "pinned":
        meta.pinned = val === "true";
        break;
      case "created_at":
        meta.created_at = val;
        break;
      case "updated_at":
        meta.updated_at = val;
        break;
    }
  }

  if (!meta.id) return null;

  const content = lines.slice(endIdx + 1).join("\n");
  return { meta, content, filePath };
}

function tryJsonParse(val: string, fallback: string): string {
  if (val.startsWith('"') && val.endsWith('"')) {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return val;
}

function serializeNote(meta: NoteMeta, content: string): string {
  const tags =
    meta.tags.length > 0
      ? `[${meta.tags.map((t) => JSON.stringify(t)).join(", ")}]`
      : "[]";
  return [
    "---",
    `id: ${meta.id}`,
    `title: ${JSON.stringify(meta.title)}`,
    `tags: ${tags}`,
    `description: ${JSON.stringify(meta.description)}`,
    `pinned: ${meta.pinned}`,
    `created_at: ${meta.created_at}`,
    `updated_at: ${meta.updated_at}`,
    "---",
    content,
  ].join("\n");
}

function loadAllNotes(dir: string): NoteFile[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const notes: NoteFile[] = [];
  for (const f of files) {
    const note = parseNote(join(dir, f));
    if (note) notes.push(note);
  }
  // Pinned first, then by updated_at desc
  notes.sort((a, b) => {
    if (a.meta.pinned !== b.meta.pinned) return a.meta.pinned ? -1 : 1;
    return b.meta.updated_at.localeCompare(a.meta.updated_at);
  });
  return notes;
}

function findNoteById(dir: string, id: string): NoteFile | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f.startsWith(id));
  for (const f of files) {
    const note = parseNote(join(dir, f));
    if (note && note.meta.id === id) return note;
  }
  return null;
}

function shortDate(iso: string): string {
  return iso ? iso.split("T")[0] : "unknown";
}

// ---------------------------------------------------------------------------
// notes_add
// ---------------------------------------------------------------------------

export const notesAdd: ToolDefinition = {
  name: "notes_add",
  category: "agent",
  group: "notes",
  title: "Add Note",
  description:
    "Create a new note with title, tags, description, and content.",
  inputSchema: {
    title: z.string().describe("Note title"),
    content: z.string().default("").describe("Note content (markdown)"),
    tags: z.array(z.string()).default([]).describe("Tags for categorization"),
    description: z
      .string()
      .default("")
      .describe("Short description of the note"),
    pinned: z
      .boolean()
      .default(false)
      .describe("Pin this note to the top of listings"),
  },
  async handler(params, context) {
    const { title, content, tags, description, pinned } = params as {
      title: string;
      content: string;
      tags: string[];
      description: string;
      pinned: boolean;
    };
    const dir = ensureNotesDir(context);
    const id = randomHexId();
    const now = new Date().toISOString();
    const meta: NoteMeta = {
      id,
      title,
      tags,
      description,
      pinned,
      created_at: now,
      updated_at: now,
    };
    const fileName = noteFileName(id, title);
    await Bun.write(join(dir, fileName), serializeNote(meta, content));
    return textResult(`Created note "${title}" (id: ${id})`);
  },
};

// ---------------------------------------------------------------------------
// notes_read
// ---------------------------------------------------------------------------

export const notesRead: ToolDefinition = {
  name: "notes_read",
  category: "agent",
  group: "notes",
  title: "Read Note",
  description:
    "Read a note by id with offset/max_length pagination.",
  inputSchema: {
    id: z.string().describe("Note ID (8-char hex)"),
    start_index: z
      .number()
      .default(0)
      .describe("Character offset to start from (default: 0)"),
    max_length: z
      .number()
      .default(5000)
      .describe("Maximum characters to return (default: 5000)"),
  },
  async handler(params, context) {
    const { id, start_index, max_length } = params as {
      id: string;
      start_index: number;
      max_length: number;
    };
    const dir = ensureNotesDir(context);
    const note = findNoteById(dir, id);
    if (!note) return errorResult(`Note "${id}" not found`);

    const { meta, content } = note;
    const { chunk, total, hasMore } = paginate(content, start_index, max_length);
    const tagsStr = meta.tags.length > 0 ? ` [${meta.tags.join(", ")}]` : "";
    const header = [
      `# ${meta.title} (${meta.id})${tagsStr}`,
      meta.description ? `> ${meta.description}` : "",
      `Pinned: ${meta.pinned} | Created: ${shortDate(meta.created_at)} | Updated: ${shortDate(meta.updated_at)}`,
      paginationHeader(start_index, chunk, total, hasMore, max_length),
    ]
      .filter(Boolean)
      .join("\n");
    return textResult(header + "\n" + chunk);
  },
};

// ---------------------------------------------------------------------------
// notes_delete
// ---------------------------------------------------------------------------

export const notesDelete: ToolDefinition = {
  name: "notes_delete",
  category: "agent",
  group: "notes",
  title: "Delete Note",
  description: "Delete a note by id.",
  inputSchema: {
    id: z.string().describe("Note ID (8-char hex)"),
  },
  async handler(params, context) {
    const { id } = params as { id: string };
    const dir = ensureNotesDir(context);
    const note = findNoteById(dir, id);
    if (!note) return errorResult(`Note "${id}" not found`);
    unlinkSync(note.filePath);
    return textResult(`Deleted note "${note.meta.title}" (${id})`);
  },
};

// ---------------------------------------------------------------------------
// notes_search
// ---------------------------------------------------------------------------

export const notesSearch: ToolDefinition = {
  name: "notes_search",
  category: "agent",
  group: "notes",
  title: "Search Notes",
  description:
    "Search notes by title, tags, or description. Returns matching notes with metadata.",
  inputSchema: {
    query: z
      .string()
      .describe("Search query (matches title, tags, and description)"),
    tag: z.string().optional().describe("Filter by exact tag name"),
  },
  async handler(params, context) {
    const { query, tag } = params as { query: string; tag?: string };
    const dir = ensureNotesDir(context);
    const notes = loadAllNotes(dir);
    const q = query.toLowerCase();

    const matches = notes.filter((n) => {
      const metaMatch =
        n.meta.title.toLowerCase().includes(q) ||
        n.meta.description.toLowerCase().includes(q) ||
        n.meta.tags.some((t) => t.toLowerCase().includes(q));
      if (tag) {
        return (
          metaMatch &&
          n.meta.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
        );
      }
      return metaMatch;
    });

    if (matches.length === 0)
      return textResult(`No notes matching "${query}"`);

    const lines = [`${matches.length} result(s):`, ""];
    for (const n of matches) {
      const pin = n.meta.pinned ? " *pinned*" : "";
      const tags =
        n.meta.tags.length > 0 ? ` (${n.meta.tags.join(", ")})` : "";
      lines.push(
        `[${n.meta.id}] ${shortDate(n.meta.updated_at)} - ${n.meta.title}${tags}${pin}`
      );
      if (n.meta.description) lines.push(`  ${n.meta.description}`);
    }
    return textResult(lines.join("\n"));
  },
};

// ---------------------------------------------------------------------------
// notes_grep
// ---------------------------------------------------------------------------

export const notesGrep: ToolDefinition = {
  name: "notes_grep",
  category: "agent",
  group: "notes",
  title: "Grep Notes",
  description:
    "Search note contents by regex pattern. Returns matching lines with context from each matching note.",
  inputSchema: {
    pattern: z
      .string()
      .describe("Regex pattern to search for (case-insensitive)"),
    context_lines: z
      .number()
      .min(0)
      .max(10)
      .default(3)
      .describe("Lines of context around each match (default: 3)"),
    max_matches: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum matches per note (default: 10)"),
  },
  async handler(params, context) {
    const { pattern, context_lines, max_matches } = params as {
      pattern: string;
      context_lines: number;
      max_matches: number;
    };
    const dir = ensureNotesDir(context);
    const notes = loadAllNotes(dir);
    const results: string[] = [];
    let totalMatches = 0;

    for (const note of notes) {
      const lines = note.content.split("\n");
      try {
        const grepResult = grepLines(
          lines,
          pattern,
          context_lines,
          max_matches
        );
        if (grepResult.matches > 0) {
          totalMatches += grepResult.matches;
          results.push(
            `--- ${note.meta.title} (${note.meta.id}) -- ${grepResult.matches} match(es)`
          );
          results.push(grepResult.output);
          results.push("");
        }
      } catch (err) {
        return errorResult(
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    if (totalMatches === 0)
      return textResult(`No matches for pattern: ${pattern}`);

    const noteCount = results.filter((l) => l.startsWith("---")).length;
    return textResult(
      [
        `${totalMatches} match(es) across ${noteCount} note(s):`,
        "",
        ...results,
      ].join("\n")
    );
  },
};

// ---------------------------------------------------------------------------
// notes_list
// ---------------------------------------------------------------------------

export const notesList: ToolDefinition = {
  name: "notes_list",
  category: "agent",
  group: "notes",
  title: "List Notes",
  description:
    "List all notes with id, date, title, tags, and description. Pinned notes appear first. Supports filtering by tag.",
  inputSchema: {
    tag: z.string().optional().describe("Filter by exact tag name"),
  },
  async handler(params, context) {
    const { tag } = params as { tag?: string };
    const dir = ensureNotesDir(context);
    let notes = loadAllNotes(dir);

    if (tag) {
      notes = notes.filter((n) =>
        n.meta.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
      );
    }

    if (notes.length === 0)
      return textResult(tag ? `No notes with tag "${tag}".` : "No notes yet.");

    const lines = [`${notes.length} note(s):`, ""];
    for (const n of notes) {
      const pin = n.meta.pinned ? " *pinned*" : "";
      const tags =
        n.meta.tags.length > 0 ? ` (${n.meta.tags.join(", ")})` : "";
      lines.push(
        `[${n.meta.id}] ${shortDate(n.meta.updated_at)} - ${n.meta.title}${tags}${pin}`
      );
      if (n.meta.description) lines.push(`  ${n.meta.description}`);
    }
    return textResult(lines.join("\n"));
  },
};

// ---------------------------------------------------------------------------
// notes_update_metadata
// ---------------------------------------------------------------------------

export const notesUpdateMetadata: ToolDefinition = {
  name: "notes_update_metadata",
  category: "agent",
  group: "notes",
  title: "Update Note Metadata",
  description:
    "Update title, tags, description, or pinned status of a note.",
  inputSchema: {
    id: z.string().describe("Note ID (8-char hex)"),
    title: z.string().optional().describe("New title"),
    tags: z
      .array(z.string())
      .optional()
      .describe("New tags (replaces existing)"),
    description: z.string().optional().describe("New description"),
    pinned: z.boolean().optional().describe("Set pinned status"),
  },
  async handler(params, context) {
    const { id, title, tags, description, pinned } = params as {
      id: string;
      title?: string;
      tags?: string[];
      description?: string;
      pinned?: boolean;
    };
    const dir = ensureNotesDir(context);
    const note = findNoteById(dir, id);
    if (!note) return errorResult(`Note "${id}" not found`);

    const { meta, content, filePath } = note;
    if (title !== undefined) meta.title = title;
    if (tags !== undefined) meta.tags = tags;
    if (description !== undefined) meta.description = description;
    if (pinned !== undefined) meta.pinned = pinned;
    meta.updated_at = new Date().toISOString();

    const newFileName = noteFileName(meta.id, meta.title);
    const newFilePath = join(dir, newFileName);

    await Bun.write(newFilePath, serializeNote(meta, content));
    if (newFilePath !== filePath) {
      try {
        unlinkSync(filePath);
      } catch {}
    }

    return textResult(`Updated note "${meta.title}" (${id})`);
  },
};

// ---------------------------------------------------------------------------
// notes_update_content
// ---------------------------------------------------------------------------

export const notesUpdateContent: ToolDefinition = {
  name: "notes_update_content",
  category: "agent",
  group: "notes",
  title: "Update Note Content",
  description:
    "Update content of a note. Modes: 'overwrite' (replace all), 'append' (add to end), 'prepend' (add to beginning), 'replace' (replace range at offset+length).",
  inputSchema: {
    id: z.string().describe("Note ID (8-char hex)"),
    content: z
      .string()
      .describe("New content to insert/append/prepend/overwrite with"),
    mode: z
      .enum(["replace", "append", "prepend", "overwrite"])
      .default("overwrite")
      .describe("Update mode (default: overwrite)"),
    offset: z
      .number()
      .optional()
      .describe("Character offset for 'replace' mode (default: 0)"),
    length: z
      .number()
      .optional()
      .describe(
        "Number of characters to replace for 'replace' mode (default: 0 = insert)"
      ),
  },
  async handler(params, context) {
    const { id, content: newContent, mode, offset, length } = params as {
      id: string;
      content: string;
      mode: string;
      offset?: number;
      length?: number;
    };
    const dir = ensureNotesDir(context);
    const note = findNoteById(dir, id);
    if (!note) return errorResult(`Note "${id}" not found`);

    const { meta, content: existing } = note;
    let updated: string;

    switch (mode) {
      case "append":
        updated = existing + newContent;
        break;
      case "prepend":
        updated = newContent + existing;
        break;
      case "overwrite":
        updated = newContent;
        break;
      case "replace": {
        const off = offset ?? 0;
        const len = length ?? 0;
        if (off < 0 || off > existing.length) {
          return errorResult(
            `Offset ${off} out of range (content length: ${existing.length})`
          );
        }
        updated =
          existing.slice(0, off) + newContent + existing.slice(off + len);
        break;
      }
      default:
        return errorResult(`Unknown mode: ${mode}`);
    }

    meta.updated_at = new Date().toISOString();
    await Bun.write(note.filePath, serializeNote(meta, updated));

    return textResult(
      `Updated content of "${meta.title}" (${id}, mode: ${mode}, ${updated.length} chars)`
    );
  },
};
