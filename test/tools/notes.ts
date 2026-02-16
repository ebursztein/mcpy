/**
 * Tests for the notes tools.
 */
import { suite, assert } from "../lib/harness.ts";
import { call } from "../lib/mcp.ts";

export async function testNotes() {
  suite("notes");

  // --- notes_add ---
  const addRes = await call("notes_add", {
    title: "Test Note",
    content: "Hello, this is test content.\nLine two.\nLine three with target word.",
    tags: ["test", "integration"],
    description: "A test note for integration testing",
  });
  assert("add returns confirmation", addRes.includes("Created note"));
  assert("add includes title", addRes.includes("Test Note"));

  const idMatch = addRes.match(/id:\s*([a-f0-9]+)/);
  assert("add returns a hex id", !!idMatch);
  const id = idMatch?.[1] ?? "";

  // --- notes_list ---
  const listRes = await call("notes_list", {});
  assert("list shows note", listRes.includes("Test Note"));
  assert("list shows tags", listRes.includes("test"));
  assert("list shows id", listRes.includes(id));
  assert("list shows count", listRes.includes("note(s)"));

  // --- notes_list with tag filter ---
  const listTagged = await call("notes_list", { tag: "integration" });
  assert("list by tag shows matching note", listTagged.includes("Test Note"));

  const listMissTag = await call("notes_list", { tag: "nonexistent" });
  assert("list by missing tag shows empty", listMissTag.includes("No notes"));

  // --- notes_read ---
  const readRes = await call("notes_read", { id });
  assert("read shows title", readRes.includes("Test Note"));
  assert("read shows content", readRes.includes("Hello, this is test content"));
  assert("read shows tags", readRes.includes("test"));

  // --- notes_read with pagination ---
  const readPaged = await call("notes_read", { id, start_index: 0, max_length: 10 });
  assert("read pagination works", readPaged.includes("Has more:"));

  // --- notes_search ---
  const searchRes = await call("notes_search", { query: "Test" });
  assert("search finds note", searchRes.includes("Test Note"));
  assert("search shows count", searchRes.includes("result(s)"));

  const searchTag = await call("notes_search", { query: "integration", tag: "test" });
  assert("search with tag filter works", searchTag.includes("Test Note"));

  const searchMiss = await call("notes_search", { query: "zzz_no_match_zzz" });
  assert("search miss returns no matches", searchMiss.includes("No notes matching"));

  // --- notes_grep ---
  const grepRes = await call("notes_grep", { pattern: "target" });
  assert("grep finds match", grepRes.includes("match"));
  assert("grep shows context", grepRes.includes("target word"));

  const grepMiss = await call("notes_grep", { pattern: "zzz_no_match_zzz" });
  assert("grep miss returns no matches", grepMiss.includes("No matches"));

  // --- notes_update_metadata ---
  const updateMeta = await call("notes_update_metadata", {
    id,
    title: "Updated Title",
    tags: ["updated", "test"],
    pinned: true,
  });
  assert("update metadata returns confirmation", updateMeta.includes("Updated note"));

  const readUpdated = await call("notes_read", { id });
  assert("read shows updated title", readUpdated.includes("Updated Title"));
  assert("read shows pinned", readUpdated.includes("Pinned: true"));

  // --- notes_update_content (append) ---
  const appendRes = await call("notes_update_content", {
    id,
    content: "\nAppended line.",
    mode: "append",
  });
  assert("append returns confirmation", appendRes.includes("Updated content"));

  const readAppended = await call("notes_read", { id });
  assert("read shows appended content", readAppended.includes("Appended line"));

  // --- notes_update_content (prepend) ---
  const prependRes = await call("notes_update_content", {
    id,
    content: "Prepended line.\n",
    mode: "prepend",
  });
  assert("prepend returns confirmation", prependRes.includes("Updated content"));

  const readPrepended = await call("notes_read", { id });
  assert("read shows prepended content", readPrepended.includes("Prepended line"));

  // --- notes_update_content (overwrite) ---
  const overwriteRes = await call("notes_update_content", {
    id,
    content: "Brand new content.",
    mode: "overwrite",
  });
  assert("overwrite returns confirmation", overwriteRes.includes("Updated content"));

  const readOverwritten = await call("notes_read", { id });
  assert("read shows overwritten content", readOverwritten.includes("Brand new content"));
  assert("read does not show old content", !readOverwritten.includes("Prepended line"));

  // --- notes_update_content (replace at offset) ---
  await call("notes_update_content", { id, content: "All new stuff here.", mode: "overwrite" });
  const replaceRes = await call("notes_update_content", {
    id,
    content: "REPLACED",
    mode: "replace",
    offset: 4,
    length: 3, // replace "new"
  });
  assert("replace returns confirmation", replaceRes.includes("Updated content"));

  const readReplaced = await call("notes_read", { id });
  assert("read shows replaced content", readReplaced.includes("REPLACED"));

  // --- Add a second note for multi-note tests ---
  const add2 = await call("notes_add", {
    title: "Second Note",
    content: "Second note content with searchable text.",
    tags: ["second"],
  });
  const id2 = add2.match(/id:\s*([a-f0-9]+)/)?.[1] ?? "";

  // --- notes_list shows both ---
  const listBoth = await call("notes_list", {});
  assert("list shows both notes", listBoth.includes("Updated Title") && listBoth.includes("Second Note"));

  // --- Pinned note appears first ---
  assert("pinned note listed first", listBoth.indexOf("Updated Title") < listBoth.indexOf("Second Note"));

  // --- notes_grep across multiple notes ---
  const grepMulti = await call("notes_grep", { pattern: "content" });
  assert("grep across notes finds results", grepMulti.includes("match"));

  // --- notes_delete ---
  const delRes = await call("notes_delete", { id });
  assert("delete returns confirmation", delRes.includes("Deleted note"));

  const del2 = await call("notes_delete", { id: id2 });
  assert("delete second note", del2.includes("Deleted note"));

  // --- Verify empty after cleanup ---
  const listEmpty = await call("notes_list", {});
  assert("list empty after deletes", listEmpty.includes("No notes"));

  // --- Error cases ---
  const readMissing = await call("notes_read", { id: "nonexist" });
  assert("read missing note returns error", readMissing.includes("not found"));

  const delMissing = await call("notes_delete", { id: "nonexist" });
  assert("delete missing note returns error", delMissing.includes("not found"));
}
