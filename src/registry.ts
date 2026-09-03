export type CommandEffect = "read" | "write" | "network" | "local";

export type FlagType = "boolean" | "string" | "number";

export interface FlagSpec {
  name: string;
  type: FlagType;
  summary: string;
  default?: boolean | string | number;
  required?: boolean;
}

export interface CommandSpec {
  path: string[];
  summary: string;
  effect: CommandEffect;
  input: {
    positionals: string[];
    flags: FlagSpec[];
  };
  output: {
    documented: boolean;
    schema?: string;
  };
  examples: string[];
}

export const commandSpecs: CommandSpec[] = [
  {
    path: ["doctor"],
    summary: "Verify environment and configuration.",
    effect: "read",
    input: {
      positionals: [],
      flags: [{ name: "--json", type: "boolean", summary: "Emit machine-readable JSON instead of human output." }],
    },
    output: { documented: true, schema: "HealthCheckResult[]" },
    examples: ["doctor --json"],
  },
  {
    path: ["schema"],
    summary: "Emit the machine-readable command catalog.",
    effect: "read",
    input: {
      positionals: ["path"],
      flags: [{ name: "--summary", type: "boolean", summary: "Return only version, command count, and command paths." }],
    },
    output: { documented: true, schema: "CommandCatalog" },
    examples: ["schema", "schema doctor --summary"],
  },
  {
    path: ["mcp-config"],
    summary: "Emit MCP config JSON for registering crm-r-us with Copilot CLI.",
    effect: "read",
    input: { positionals: [], flags: [] },
    output: { documented: true, schema: "McpConfig" },
    examples: ["mcp-config"],
  },
  {
    path: ["mcp-server"],
    summary: "Start the crm-r-us stdio MCP server.",
    effect: "local",
    input: {
      positionals: [],
      flags: [{ name: "--db", type: "string", summary: "SQLite database file. Default ~/.crm-r-us/crm.db" }],
    },
    output: { documented: false, schema: "MCP stdio transport" },
    examples: ["mcp-server", "mcp-server --db ./demo.db"],
  },
  {
    path: ["serve"],
    summary: "Run the crm-r-us MCP server as a long-lived streamable HTTP service.",
    effect: "local",
    input: {
      positionals: [],
      flags: [
        { name: "--port", type: "string", summary: "TCP port to listen on.", default: "3737" },
        { name: "--host", type: "string", summary: "Address to bind. 0.0.0.0 exposes it on your network.", default: "0.0.0.0" },
        { name: "--db", type: "string", summary: "SQLite database file. Default ~/.crm-r-us/crm.db" },
        { name: "--quiet", type: "boolean", summary: "Do not print per-request activity." },
      ],
    },
    output: { documented: false, schema: "MCP streamable HTTP transport" },
    examples: ["serve", "serve --port 8080 --host 127.0.0.1"],
  },
  {
    path: ["mcp-schema"],
    summary: "List crm-r-us MCP tools through a local MCP client.",
    effect: "read",
    input: { positionals: [], flags: [] },
    output: { documented: true, schema: "ListToolsResult" },
    examples: ["mcp-schema"],
  },
  {
    path: ["mcp-call"],
    summary: "Call a crm-r-us MCP tool through a local MCP client.",
    effect: "local",
    input: {
      positionals: ["tool", "jsonArgs"],
      flags: [],
    },
    output: { documented: true, schema: "CallToolResult" },
    examples: ["mcp-call ping", "mcp-call demo_seed", "mcp-call account_search {\"query\":\"Contoso\"}"],
  },
  {
    path: ["mos3-package"],
    summary: "Build a MOS3 app package that registers crm-r-us as an MCP agent connector.",
    effect: "write",
    input: {
      positionals: [],
      flags: [
        {
          name: "--url",
          type: "string",
          summary: "Public MCP endpoint Copilot calls, for example https://<your-tunnel>/mcp.",
          required: true,
        },
        { name: "--out", type: "string", summary: "Output zip path.", default: "crm-r-us-mos3.zip" },
        { name: "--version", type: "string", summary: "App package version.", default: "1.0.0" },
      ],
    },
    output: { documented: true, schema: "Mos3PackageResult" },
    examples: [
      "mos3-package --url https://example.devtunnels.ms/mcp",
      "mos3-package --url https://example.devtunnels.ms/mcp --out dist/crm.zip",
    ],
  },
  {
    path: ["update"],
    summary: "Self-update this crm-r-us checkout with git pull, npm install, and rebuild crm-r-us.",
    effect: "write",
    input: {
      positionals: [],
      flags: [{ name: "--json", type: "boolean", summary: "Emit machine-readable JSON instead of human output." }],
    },
    output: { documented: true, schema: "UpdateResult" },
    examples: ["update --json"],
  },
];

function pathMatchesPrefix(path: string[], prefix: string[]): boolean {
  return prefix.every((part, index) => path[index] === part);
}

export function buildSchema(cliVersion: string, pathPrefix: string[] = [], summary = false) {
  const commands = commandSpecs.filter((command) => pathMatchesPrefix(command.path, pathPrefix));
  if (summary) {
    return {
      schemaVersion: 1,
      cliVersion,
      commandCount: commands.length,
      commandPaths: commands.map((command) => command.path),
    };
  }

  return {
    schemaVersion: 1,
    cliVersion,
    envelope: {
      stdout: "JSON only for non-interactive commands when --json or schema is used",
      stderr: "progress, diagnostics, and human narration",
      successEnvelope: ["ok", "command", "data"],
      errorEnvelope: ["ok", "command", "error", "hint"],
    },
    globalFlags: [
      { name: "--help", type: "boolean", summary: "Show command help." },
      { name: "--version", type: "boolean", summary: "Show CLI version." },
    ],
    commands,
    errorCodes: [],
    exitCodes: [
      { code: 0, meaning: "Success." },
      { code: 1, meaning: "Command failed." },
    ],
  };
}
