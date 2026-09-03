import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MEMORY_DB, openDb } from "../../src/crm/db.js";
import { createCrmRUsServer } from "../../src/server.js";

interface ToolEnvelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
  hint?: string;
}

async function connectClient() {
  const server = createCrmRUsServer({ db: openDb(MEMORY_DB) });
  const client = new Client({ name: "crm-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolEnvelope> => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
    };
    assert.equal(result.content[0].type, "text");
    return JSON.parse(result.content[0].text) as ToolEnvelope;
  };

  return { client, call };
}

describe("mcp server", () => {
  it("constructs against an in-memory database", () => {
    const server = createCrmRUsServer({ db: openDb(MEMORY_DB) });
    assert.equal(typeof server, "object");
  });

  it("exposes the CRM verb surface over a real MCP client", async () => {
    const { client, call } = await connectClient();

    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    for (const expected of [
      "ping",
      "account_create",
      "contact_create",
      "deal_create",
      "deal_advance_stage",
      "deal_close",
      "activity_log",
      "task_create",
      "report_pipeline",
      "report_stats",
      "demo_seed",
      "demo_reset",
    ]) {
      assert.ok(tools.includes(expected), `expected tool ${expected}`);
    }

    assert.deepEqual(await call("ping"), { ok: true, data: { message: "pong" } });
    await client.close();
  });

  it("runs a full sell cycle through tool calls", async () => {
    const { client, call } = await connectClient();

    const account = await call("account_create", { name: "Fabrikam Health", industry: "Healthcare", owner: "dana" });
    const accountId = account.data?.id as string;
    assert.equal(account.ok, true);

    const contact = await call("contact_create", { accountId, firstName: "Noah", lastName: "Klein" });
    const contactId = contact.data?.id as string;

    const deal = await call("deal_create", { name: "Records migration", accountId, contactId, amount: 320000 });
    const dealId = deal.data?.id as string;
    assert.equal(deal.data?.stage, "lead");

    assert.equal((await call("deal_advance_stage", { id: dealId })).data?.stage, "qualified");
    assert.equal((await call("activity_log", { type: "call", subject: "Scoping", dealId })).ok, true);

    const task = await call("task_create", { title: "Draft SOW", dealId, dueDate: "2030-01-01" });
    assert.equal((await call("task_complete", { id: task.data?.id as string })).data?.status, "done");

    const pipeline = await call("report_pipeline");
    assert.equal(pipeline.data?.openDealCount, 1);

    const closed = await call("deal_close", { id: dealId, outcome: "won", reason: "Security review passed." });
    assert.equal(closed.data?.status, "won");

    const stats = await call("report_stats");
    assert.deepEqual(stats.data?.deals, { open: 0, won: 1, lost: 0 });

    await client.close();
  });

  it("advertises safety annotations for every tool", async () => {
    const { client } = await connectClient();

    const byName = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool.annotations]));

    assert.deepEqual(byName.get("report_pipeline"), {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.deepEqual(byName.get("account_delete"), {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    assert.deepEqual(byName.get("account_create"), {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });

    for (const [name, annotations] of byName) {
      assert.equal(typeof annotations?.readOnlyHint, "boolean", `${name} needs a readOnlyHint`);
      assert.equal(annotations?.openWorldHint, false, `${name} touches only the local database`);
    }

    await client.close();
  });

  it("returns an actionable error envelope for a missing record", async () => {
    const { client, call } = await connectClient();

    const missing = await call("deal_get", { id: "deal_missing" });

    assert.equal(missing.ok, false);
    assert.equal(missing.error?.code, "not_found");
    assert.ok(missing.hint);

    await client.close();
  });

  it("seeds and resets demo data through tool calls", async () => {
    const { client, call } = await connectClient();

    const seeded = await call("demo_seed");
    assert.equal(seeded.data?.accounts, 8);

    const cleared = await call("demo_reset");
    assert.equal((cleared.data?.stats as { accounts: number }).accounts, 0);

    await client.close();
  });
});
