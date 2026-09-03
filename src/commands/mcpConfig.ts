export function buildMcpConfig() {
  return {
    mcpServers: {
      "crm-r-us": {
        type: "local",
        command: "crm-r-us",
        args: ["mcp-server"],
        tools: ["*"],
      },
    },
  };
}

export async function mcpConfigCommand(): Promise<void> {
  process.stdout.write(`${JSON.stringify(buildMcpConfig(), null, 2)}\n`);
}
