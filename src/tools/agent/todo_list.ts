import { z } from "zod";
import { join } from "path";
import type { ToolDefinition, GroupDefinition } from "../base.ts";
import { textResult, errorResult } from "../base.ts";

export const todoGroup: GroupDefinition = {
  id: "todo",
  category: "agent",
  label: "Todo List",
  description: "Persistent task tracking across conversations",
  requiresConfig: false,
  enabledByDefault: true,
};

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
  updated_at: string;
}

async function loadTodos(dataDir: string): Promise<TodoItem[]> {
  const file = Bun.file(join(dataDir, "todos.json"));
  if (await file.exists()) {
    try {
      return await file.json();
    } catch {
      return [];
    }
  }
  return [];
}

async function saveTodos(dataDir: string, todos: TodoItem[]): Promise<void> {
  await Bun.write(join(dataDir, "todos.json"), JSON.stringify(todos, null, 2));
}

const tool: ToolDefinition = {
  name: "todo_list",
  category: "agent",
  group: "todo",
  title: "Todo List",
  description:
    "Persistent todo list for tracking tasks. Supports list, add, update, remove, and clear actions.",
  inputSchema: {
    action: z
      .enum(["list", "add", "update", "remove", "clear"])
      .describe("Action to perform"),
    id: z.string().optional().describe("Todo ID (for update/remove)"),
    text: z.string().optional().describe("Todo text (for add/update)"),
    done: z
      .boolean()
      .optional()
      .describe("Mark as done/undone (for update)"),
  },
  async handler(params, context) {
    const { action, id, text, done } = params as {
      action: string;
      id?: string;
      text?: string;
      done?: boolean;
    };

    const todos = await loadTodos(context.dataDir);

    switch (action) {
      case "list": {
        if (todos.length === 0) return textResult("No todos yet.");
        const lines = todos.map(
          (t, i) =>
            `${i + 1}. [${t.done ? "x" : " "}] ${t.text} (id: ${t.id})`
        );
        return textResult(lines.join("\n"));
      }

      case "add": {
        if (!text) return errorResult("'text' is required for add action");
        const newTodo: TodoItem = {
          id: crypto.randomUUID().slice(0, 8),
          text,
          done: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        todos.push(newTodo);
        await saveTodos(context.dataDir, todos);
        return textResult(`Added todo: "${text}" (id: ${newTodo.id})`);
      }

      case "update": {
        if (!id) return errorResult("'id' is required for update action");
        const todo = todos.find((t) => t.id === id);
        if (!todo) return errorResult(`Todo with id "${id}" not found`);
        if (text !== undefined) todo.text = text;
        if (done !== undefined) todo.done = done;
        todo.updated_at = new Date().toISOString();
        await saveTodos(context.dataDir, todos);
        return textResult(
          `Updated todo ${id}: "${todo.text}" [${todo.done ? "done" : "pending"}]`
        );
      }

      case "remove": {
        if (!id) return errorResult("'id' is required for remove action");
        const idx = todos.findIndex((t) => t.id === id);
        if (idx === -1) return errorResult(`Todo with id "${id}" not found`);
        const removed = todos.splice(idx, 1)[0];
        await saveTodos(context.dataDir, todos);
        return textResult(`Removed todo: "${removed.text}"`);
      }

      case "clear": {
        await saveTodos(context.dataDir, []);
        return textResult("All todos cleared.");
      }

      default:
        return errorResult(`Unknown action: ${action}`);
    }
  },
};

export default tool;
