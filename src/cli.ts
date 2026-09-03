#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { doctorCommand } from "./commands/doctor.js";
import { mcpCallCommand, mcpSchemaCommand } from "./commands/mcpDebug.js";
import { mcpConfigCommand } from "./commands/mcpConfig.js";
import { schemaCommand } from "./commands/schema.js";
import { DEFAULT_HOST, DEFAULT_PORT, serveCommand } from "./service.js";
import { startMcpServer } from "./server.js";
import { updateCommand } from "./commands/update.js";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const VERSION = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;

const program = new Command();

program
  .name("crm-r-us")
  .description("Local SQLite-backed CRM exposed as MCP tools for demos")
  .version(VERSION);

program
  .command("doctor")
  .description("Health check: verify environment and configuration")
  .option("--json", "Emit machine-readable JSON instead of human output")
  .action(doctorCommand);

program
  .command("schema [path...]")
  .description("Emit the machine-readable command catalog")
  .option("--summary", "Return only version, command count, and command paths")
  .action((pathArgs: string[] | undefined, opts: { summary?: boolean }) => schemaCommand(pathArgs ?? [], opts, VERSION));

program
  .command("mcp-config")
  .description("Emit MCP config JSON for registering this server with Copilot CLI")
  .action(mcpConfigCommand);

program
  .command("mcp-server")
  .description("Start the stdio MCP server")
  .option("--db <path>", "SQLite database file. Default ~/.crm-r-us/crm.db")
  .action((opts: { db?: string }) => startMcpServer({ dbPath: opts.db }));

program
  .command("serve")
  .description("Run the MCP server as a long-lived streamable HTTP service")
  .option("--port <port>", "TCP port to listen on", String(DEFAULT_PORT))
  .option("--host <host>", "Address to bind. 0.0.0.0 exposes it on your network", DEFAULT_HOST)
  .option("--db <path>", "SQLite database file. Default ~/.crm-r-us/crm.db")
  .option("--quiet", "Do not print per-request activity")
  .action(serveCommand);

program
  .command("mcp-schema")
  .description("Debug this MCP by listing tools through a local MCP client")
  .action(mcpSchemaCommand);

program
  .command("mcp-call <tool> [jsonArgs]")
  .description("Debug this MCP by calling a tool through a local MCP client")
  .action(mcpCallCommand);

program
  .command("update")
  .description("Self-update: git pull, npm install, and rebuild crm-r-us")
  .option("--json", "Emit machine-readable JSON instead of human output")
  .action(updateCommand);

if (process.argv.slice(2).length === 0) {
  process.stdout.write(`crm-r-us v${VERSION}\n\n`);
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
