import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  CONNECTOR_ID,
  buildAgentConnector,
  buildAppManifest,
  buildMos3Package,
  deterministicUuid,
} from "../../src/mos3/package.js";
import { requireMcpUrl } from "../../src/commands/mos3Package.js";

const URL_UNDER_TEST = "https://example.test/mcp";

describe("mos3 package", () => {
  it("registers the MCP server as an unauthenticated remote agent connector", () => {
    const connector = buildAgentConnector(URL_UNDER_TEST) as {
      id: string;
      displayName: string;
      description: string;
      toolSource: { remoteMcpServer: { mcpServerUrl: string } };
    };

    assert.equal(connector.id, CONNECTOR_ID);
    assert.ok(connector.displayName.length > 0);
    assert.ok(connector.description.length > 0);
    assert.equal(connector.toolSource.remoteMcpServer.mcpServerUrl, URL_UNDER_TEST);
  });

  it("selects dynamic tool discovery by leaving the tool description out", () => {
    const remote = (
      buildAgentConnector(URL_UNDER_TEST) as {
        toolSource: { remoteMcpServer: Record<string, unknown> };
      }
    ).toolSource.remoteMcpServer;

    assert.deepEqual(Object.keys(remote), ["mcpServerUrl"]);
  });

  it("declares a manifest version that supports dynamic discovery", () => {
    const manifest = buildAppManifest(URL_UNDER_TEST, "2.1.0") as {
      $schema: string;
      manifestVersion: string;
      version: string;
      id: string;
      agentConnectors: Array<{ id: string }>;
    };

    const version = Number.parseFloat(manifest.manifestVersion);
    assert.ok(version >= 1.29, `manifest version ${manifest.manifestVersion} is below 1.29`);
    assert.ok(manifest.$schema.includes(`v${manifest.manifestVersion}`));
    assert.equal(manifest.version, "2.1.0");
    assert.match(manifest.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(manifest.agentConnectors.map((c) => c.id), [CONNECTOR_ID]);
  });

  it("keeps the same app id across rebuilds", () => {
    assert.equal(deterministicUuid("CRM R Us"), deterministicUuid("CRM R Us"));
    assert.notEqual(deterministicUuid("CRM R Us"), deterministicUuid("Other App"));
  });

  it("builds a manifest and two icons, and nothing else", () => {
    const entries = buildMos3Package({ url: URL_UNDER_TEST });

    assert.deepEqual(entries.map((entry) => entry.path), ["manifest.json", "color.png", "outline.png"]);

    const png = entries.find((entry) => entry.path === "color.png")!.content;
    assert.equal(png.subarray(0, 4).toString("hex"), "89504e47", "the icon is a real PNG");
  });

  it("writes the caller's endpoint into the connector", () => {
    const entries = buildMos3Package({ url: "https://other.test/mcp" });
    const manifest = JSON.parse(entries.find((entry) => entry.path === "manifest.json")!.content.toString("utf8")) as {
      agentConnectors: Array<{ toolSource: { remoteMcpServer: { mcpServerUrl: string } } }>;
    };

    assert.equal(manifest.agentConnectors[0]!.toolSource.remoteMcpServer.mcpServerUrl, "https://other.test/mcp");
  });

  it("accepts an absolute https endpoint", () => {
    assert.equal(requireMcpUrl(URL_UNDER_TEST), URL_UNDER_TEST);
  });

  it("names the flag when the endpoint is missing or unusable", () => {
    assert.throws(() => requireMcpUrl(undefined), /Missing --url/);
    assert.throws(() => requireMcpUrl("example.test/mcp"), /Invalid --url/);
    assert.throws(() => requireMcpUrl("http://example.test/mcp"), /https URL/);
  });
});
