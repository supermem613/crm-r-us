import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildMcpConfig } from "../../src/commands/mcpConfig.js";

describe("mcp-config", () => {
  it("emits Copilot CLI local server config", () => {
    assert.deepEqual(buildMcpConfig(), {
      mcpServers: {
        "crm-r-us": {
          type: "local",
          command: "crm-r-us",
          args: ["mcp-server"],
          tools: ["*"],
        },
      },
    });
  });
});
