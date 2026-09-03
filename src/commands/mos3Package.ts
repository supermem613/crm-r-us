import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { APP_VERSION, buildMos3Package } from "../mos3/package.js";
import { createZip } from "../mos3/zip.js";

export const DEFAULT_PACKAGE_PATH = "crm-r-us-mos3.zip";

export interface Mos3PackageCommandOptions {
  url?: string;
  out?: string;
  version?: string;
}

/**
 * The endpoint is baked into the package, so a wrong value fails only later,
 * inside Copilot. Reject it here where the message can name the flag.
 */
export function requireMcpUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(
      "Missing --url. Pass the public MCP endpoint Copilot calls, for example --url https://<your-tunnel>/mcp.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid --url "${value}". Use an absolute URL, for example https://<your-tunnel>/mcp.`);
  }

  // Microsoft 365 refuses a cleartext connector, so catch it here, not at upload.
  if (parsed.protocol !== "https:") {
    throw new Error(`Invalid --url "${value}". Use an https URL. Microsoft 365 rejects a cleartext MCP endpoint.`);
  }

  // Copilot calls this URL as the MCP endpoint. Our server only speaks MCP
  // at /mcp, so a bare host bakes a connector that can never initialize.
  if (parsed.pathname !== "/mcp") {
    throw new Error(
      `Invalid --url "${value}". The path must be /mcp. This service speaks MCP only at that path, for example https://<your-tunnel>/mcp.`,
    );
  }

  return parsed.toString();
}

export async function mos3PackageCommand(options: Mos3PackageCommandOptions): Promise<void> {
  const url = requireMcpUrl(options.url);
  const version = options.version ?? APP_VERSION;
  const outPath = resolve(options.out ?? DEFAULT_PACKAGE_PATH);

  const entries = buildMos3Package({ url, version });
  const zip = createZip(entries);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, zip);

  const result = {
    ok: true,
    command: "mos3-package",
    data: {
      path: outPath,
      url,
      version,
      surface: "agentConnector",
      toolDiscovery: "dynamic",
      files: entries.map((entry) => entry.path),
      bytes: zip.length,
    },
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
