import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function withLocalMcpClient<T>(callback: (client: Client) => Promise<T>): Promise<T> {
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), "..", "server.js");
  const client = new Client({ name: "local-mcp-debug", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    return await callback(client);
  } finally {
    await client.close();
  }
}

export async function mcpSchemaCommand(): Promise<void> {
  const response = await withLocalMcpClient((client) => client.listTools());
  process.stdout.write(`${JSON.stringify({ ok: true, command: "mcp-schema", data: response })}\n`);
}

export async function mcpCallCommand(tool: string, jsonArgs: string | undefined): Promise<void> {
  const args = parseJsonArgs(jsonArgs);
  const response = await withLocalMcpClient((client) => client.callTool({ name: tool, arguments: args }));
  process.stdout.write(`${JSON.stringify({ ok: true, command: "mcp-call", data: response })}\n`);
}

function parseJsonArgs(value: string | undefined): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("jsonArgs must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}
