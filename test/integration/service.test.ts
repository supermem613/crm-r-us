import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MEMORY_DB, openDb } from "../../src/crm/db.js";
import { startCrmService, type RunningService } from "../../src/service.js";

interface ToolEnvelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

async function withService<T>(run: (service: RunningService, base: string) => Promise<T>): Promise<T> {
  // Port 0 asks the OS for a free port so parallel test runs never collide.
  const service = await startCrmService({ port: 0, host: "127.0.0.1", db: openDb(MEMORY_DB) });
  const base = `http://127.0.0.1:${service.port}`;
  try {
    return await run(service, base);
  } finally {
    await service.close();
  }
}

async function connect(base: string) {
  const client = new Client({ name: "crm-http-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolEnvelope> => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
    };
    return JSON.parse(result.content[0].text) as ToolEnvelope;
  };

  return { client, call };
}

describe("crm http service", () => {
  it("serves CRM tools to a streamable HTTP MCP client", async () => {
    await withService(async (service, base) => {
      const { client, call } = await connect(base);

      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      assert.ok(tools.includes("account_create"));
      assert.ok(tools.includes("report_pipeline"));

      assert.deepEqual(await call("ping"), { ok: true, data: { message: "pong" } });
      assert.equal(service.sessionCount(), 1, "the initialized session is tracked");

      await client.close();
    });
  });

  it("shares one database across concurrent sessions", async () => {
    await withService(async (service, base) => {
      const first = await connect(base);
      const second = await connect(base);

      assert.equal(service.sessionCount(), 2);

      const created = await first.call("account_create", { name: "Litware Financial", owner: "kai" });
      const found = await second.call("account_search", { query: "Litware" });

      const accounts = found.data as unknown as { id: string }[];
      assert.equal(accounts.length, 1, "a second session sees the first session's write");
      assert.equal(accounts[0].id, created.data?.id);

      await first.client.close();
      await second.client.close();
    });
  });

  it("reports health with live stats and session count", async () => {
    await withService(async (_service, base) => {
      const { client, call } = await connect(base);
      await call("demo_seed");

      const response = await fetch(`${base}/health`);
      const health = (await response.json()) as {
        ok: boolean;
        sessions: number;
        stats: { accounts: number };
      };

      assert.equal(response.status, 200);
      assert.equal(health.ok, true);
      assert.equal(health.sessions, 1);
      assert.equal(health.stats.accounts, 8);

      await client.close();
    });
  });

  it("reclaims a session that has been idle past the timeout", async () => {
    const service = await startCrmService({
      port: 0,
      host: "127.0.0.1",
      db: openDb(MEMORY_DB),
      idleTimeoutMs: 60_000,
    });
    try {
      const base = `http://127.0.0.1:${service.port}`;
      const { client, call } = await connect(base);
      await call("ping");

      assert.equal(service.sessionCount(), 1);
      assert.equal(service.sweepIdleSessions(Date.now()), 0, "an active session survives a sweep");
      assert.equal(service.sessionCount(), 1);

      const afterTimeout = Date.now() + 61_000;
      assert.equal(service.sweepIdleSessions(afterTimeout), 1, "an idle session is reclaimed");
      assert.equal(service.sessionCount(), 0);

      await client.close();
    } finally {
      await service.close();
    }
  });

  it("keeps a session alive while it keeps making calls", async () => {
    const service = await startCrmService({
      port: 0,
      host: "127.0.0.1",
      db: openDb(MEMORY_DB),
      idleTimeoutMs: 60_000,
    });
    try {
      const base = `http://127.0.0.1:${service.port}`;
      const { client, call } = await connect(base);

      // Each call refreshes lastSeenAt, so a sweep 59s after the previous call
      // still finds the session active.
      for (let i = 0; i < 3; i++) {
        await call("ping");
        assert.equal(service.sweepIdleSessions(Date.now() + 59_000), 0);
      }
      assert.equal(service.sessionCount(), 1);

      await client.close();
    } finally {
      await service.close();
    }
  });

  it("rejects a POST that carries an unknown session id", async () => {
    await withService(async (_service, base) => {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json, text/event-stream",
          "mcp-session-id": "not-a-real-session",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });

      assert.equal(response.status, 404);
      const body = (await response.json()) as { error: { message: string } };
      assert.match(body.error.message, /Unknown MCP session/);
    });
  });

  it("rejects an uninitialized POST and an unknown path", async () => {
    await withService(async (_service, base) => {
      const uninitialized = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      assert.equal(uninitialized.status, 400);

      const missing = await fetch(`${base}/nope`);
      assert.equal(missing.status, 404);
    });
  });
});
