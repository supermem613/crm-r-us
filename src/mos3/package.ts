import { createHash } from "node:crypto";
import type { ZipEntry } from "./zip.js";

export const APP_NAME = "CRM-R-Us";
export const APP_VERSION = "1.0.0";

/**
 * Agent connectors reach dynamic tool discovery only from manifest 1.29. On an
 * older version the connector loads with no tools and gives no reason why.
 */
const MANIFEST_VERSION = "1.29";

export const CONNECTOR_ID = "crm-r-us";

/** One 64x64 placeholder square used for both icons. Replace before publishing. */
const ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAeElEQVR4nO3QQQ3AIADAQMAwKjCFbDQL/4OEPUsm37B59w7YV96zHQAAAPjPMQUwBTBmAmtBAPyhAAZgCmAMBNYCAfgOAQzAFMAYCKwFAvAdAhiAKYAxEFgLBOA7BDAAUwBjILAWEEDvEMAATAFMBQAAwEVvYg6mEK2fefYAAAAASUVORK5CYII=";

export interface Mos3PackageOptions {
  /** The public MCP endpoint Copilot calls. Tunnel URLs expire, so the caller
   * always states it and no stale default can ship. */
  url: string;
  version?: string;
}

/** Derives a stable UUID from a name so rebuilds keep the same catalog identity. */
export function deterministicUuid(name: string): string {
  const hash = createHash("sha256").update(name).digest("hex");
  const variant = ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${variant}${hash.slice(18, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

/**
 * Registers the MCP server as an agent connector at the root of the app
 * manifest. Any Microsoft 365 agent that speaks MCP, including Cowork, can then
 * pick the tools up. A declarative agent would not reach Cowork at all.
 *
 * `mcpToolDescription` is deliberately absent. Omitting it selects dynamic tool
 * discovery, so the host reads `tools/list` at run time and a new CRM tool needs
 * no republish.
 */
export function buildAgentConnector(url: string): Record<string, unknown> {
  return {
    id: CONNECTOR_ID,
    displayName: APP_NAME,
    description:
      "Read and update accounts, contacts, deals, activities, and tasks in the CRM-R-Us demo CRM, and report on the sales pipeline.",
    toolSource: {
      remoteMcpServer: {
        mcpServerUrl: url,
        // `authorization` is deliberately absent. The MOS3 manifest schema only
        // accepts the capitalized "None", but the Knowledge Agent host compares
        // the value against the lowercase 'none' and treats every other spelling
        // as an authenticated server, which fails the connector with
        // MCP_AUTH_UNSUPPORTED. Omitting the key satisfies both: MOS3 treats it
        // as optional and the host takes its "no authorization" branch.
      },
    },
  };
}

export function buildAppManifest(url: string, version: string): Record<string, unknown> {
  return {
    $schema: `https://developer.microsoft.com/json-schemas/teams/v${MANIFEST_VERSION}/MicrosoftTeams.schema.json`,
    manifestVersion: MANIFEST_VERSION,
    id: deterministicUuid(APP_NAME),
    version,
    developer: {
      name: "Marcus Markiewicz",
      websiteUrl: "https://www.microsoft.com",
      privacyUrl: "https://privacy.microsoft.com/privacystatement",
      termsOfUseUrl: "https://www.microsoft.com/servicesagreement",
    },
    name: { short: APP_NAME, full: APP_NAME },
    description: {
      short: "Demo CRM for accounts, contacts, deals, and tasks.",
      full: "CRM-R-Us is a demo customer relationship manager. It tracks accounts, contacts, deals, activities, and follow-up tasks, and reports on the sales pipeline.",
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: "#6264A7",
    agentConnectors: [buildAgentConnector(url)],
  };
}

/** Builds every file of the MOS3 app package, ready to zip. */
export function buildMos3Package(options: Mos3PackageOptions): ZipEntry[] {
  const version = options.version ?? APP_VERSION;
  const icon = Buffer.from(ICON_PNG_BASE64, "base64");
  const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

  return [
    { path: "manifest.json", content: json(buildAppManifest(options.url, version)) },
    { path: "color.png", content: icon },
    { path: "outline.png", content: icon },
  ];
}
