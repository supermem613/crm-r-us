import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_HOST, DEFAULT_PORT, describeCall, resolveServeOptions } from "../../src/service.js";
import { commandSpecs } from "../../src/registry.js";

describe("serve defaults", () => {
  it("runs on port 3737, binds 0.0.0.0, and uses the standard database with no flags", () => {
    const resolved = resolveServeOptions();

    assert.equal(resolved.port, 3737);
    assert.equal(resolved.host, "0.0.0.0");
    assert.equal(resolved.dbPath, join(homedir(), ".crm-r-us", "crm.db"));
  });

  it("lets each flag override its default independently", () => {
    assert.deepEqual(resolveServeOptions({ port: "8080" }), {
      port: 8080,
      host: DEFAULT_HOST,
      dbPath: join(homedir(), ".crm-r-us", "crm.db"),
      log: true,
    });
    assert.equal(resolveServeOptions({ host: "127.0.0.1" }).host, "127.0.0.1");
    assert.equal(resolveServeOptions({ db: "./demo.db" }).dbPath, "./demo.db");
  });

  it("rejects a port outside the valid range", () => {
    assert.throws(() => resolveServeOptions({ port: "0" }), /Invalid --port/);
    assert.throws(() => resolveServeOptions({ port: "70000" }), /Invalid --port/);
    assert.throws(() => resolveServeOptions({ port: "http" }), /Invalid --port/);
  });

  it("prints activity by default and stays silent with --quiet", () => {
    assert.equal(resolveServeOptions().log, true);
    assert.equal(resolveServeOptions({ quiet: true }).log, false);
    assert.equal(resolveServeOptions({ quiet: false }).log, true);
  });

  it("documents the same defaults in the command catalog", () => {
    const serve = commandSpecs.find((command) => command.path[0] === "serve");
    assert.ok(serve, "serve is in the registry");

    const flag = (name: string) => serve.input.flags.find((entry) => entry.name === name);
    assert.equal(flag("--port")?.default, String(DEFAULT_PORT));
    assert.equal(flag("--host")?.default, DEFAULT_HOST);
  });
});

describe("activity log summary", () => {
  it("names the CRM verb for a tool call", () => {
    assert.equal(
      describeCall({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "deal_close", arguments: {} } }),
      "deal_close",
    );
  });

  it("names the protocol method when the call is not a tool call", () => {
    assert.equal(describeCall({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), "tools/list");
    assert.equal(describeCall({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), "initialize");
  });

  it("joins a batched body and falls back for an unreadable one", () => {
    assert.equal(
      describeCall([
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "account_create" } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "contact_create" } },
      ]),
      "account_create, contact_create",
    );
    assert.equal(describeCall(undefined), "?");
    assert.equal(describeCall({ jsonrpc: "2.0" }), "?");
  });
});
