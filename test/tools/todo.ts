/**
 * Tests for the todo_list tool.
 */
import { suite, assert } from "../lib/harness.ts";
import { call } from "../lib/mcp.ts";

export async function testTodo() {
  suite("todo_list");

  // start clean
  await call("todo_list", { action: "clear" });

  // add
  const addRes = await call("todo_list", { action: "add", text: "buy milk" });
  assert("add returns confirmation", addRes.includes("Added todo"));
  assert("add includes text", addRes.includes("buy milk"));

  // extract id from "Added todo: "buy milk" (id: xxx)"
  const idMatch = addRes.match(/id:\s*([a-z0-9]+)/);
  assert("add returns an id", !!idMatch);
  const id = idMatch?.[1] ?? "";

  // list
  const listRes = await call("todo_list", { action: "list" });
  assert("list shows item", listRes.includes("buy milk"));
  assert("list shows unchecked", listRes.includes("[ ]"));

  // update text
  const updateRes = await call("todo_list", { action: "update", id, text: "buy oat milk" });
  assert("update returns confirmation", updateRes.includes("Updated todo"));
  assert("update reflects new text", updateRes.includes("oat milk"));

  // mark done
  const doneRes = await call("todo_list", { action: "update", id, done: true });
  assert("mark done returns confirmation", doneRes.includes("done"));

  // verify done in list
  const listDone = await call("todo_list", { action: "list" });
  assert("list shows checked", listDone.includes("[x]"));

  // add a second item then remove by id
  const add2 = await call("todo_list", { action: "add", text: "temp item" });
  const id2 = add2.match(/id:\s*([a-z0-9]+)/)?.[1] ?? "";
  const removeRes = await call("todo_list", { action: "remove", id: id2 });
  assert("remove returns confirmation", removeRes.includes("Removed todo"));

  // clear
  const clearRes = await call("todo_list", { action: "clear" });
  assert("clear returns confirmation", clearRes.includes("cleared"));

  // verify empty
  const emptyList = await call("todo_list", { action: "list" });
  assert("list is empty after clear", emptyList.includes("No todos"));
}
