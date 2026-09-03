#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDbPath, openDb, type Db } from "./crm/db.js";
import { registerCrmTools } from "./mcp/tools.js";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name: string; version: string };

export interface CrmServerOptions {
  /** SQLite file path, or ":memory:" for an ephemeral database. */
  dbPath?: string;
  /** Already-open database. Takes precedence over dbPath. Used by tests. */
  db?: Db;
}

export function createCrmRUsServer(options: CrmServerOptions = {}): McpServer {
  const server = new McpServer({
    name: pkg.name,
    version: pkg.version,
  });
  registerCrmTools(server, options.db ?? openDb(options.dbPath ?? defaultDbPath()));
  return server;
}

export async function startMcpServer(options: CrmServerOptions = {}): Promise<void> {
  await createCrmRUsServer(options).connect(new StdioServerTransport());
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbFlag = process.argv.indexOf("--db");
  await startMcpServer(dbFlag === -1 ? {} : { dbPath: process.argv[dbFlag + 1] });
}
