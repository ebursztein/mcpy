/**
 * Shared MCP client setup -- connect to a mcpy binary via stdio.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client | null = null;

export async function connect(binary: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: binary,
    stderr: "pipe",
  });

  client = new Client(
    { name: "mcpy-test", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

export async function disconnect(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export function getClient(): Client {
  if (!client) throw new Error("MCP client not connected -- call connect() first");
  return client;
}

/** Extract text content from an MCP tool call result. */
export function text(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  if (r?.content) {
    return r.content
      .filter((c) => c.type === "text")
      .map((c) => c.text || "")
      .join("\n");
  }
  return JSON.stringify(result);
}

/** Call a tool and return the text content. */
export async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  return text(await getClient().callTool({ name, arguments: args }));
}
