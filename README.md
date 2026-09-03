# crm-r-us

> Local SQLite-backed CRM exposed as MCP tools for demos

crm-r-us is a stdio MCP server with a small companion CLI for configuration,
schema discovery, local debugging, and updates.

## Quick start

```bash
git clone https://github.com/<you>/crm-r-us.git ~/repos/crm-r-us
cd ~/repos/crm-r-us
npm install
npm run build
npm link
```

## Run it as a service

`serve` runs the same CRM over the MCP streamable HTTP transport, so it stays up
across clients instead of dying with one stdio session.

```bash
crm-r-us serve
```

With no flags that is port `3737`, bound to `0.0.0.0`, on `~/.crm-r-us/crm.db`.
Override any of them:

```bash
crm-r-us serve --port 8080 --host 127.0.0.1 --db ./demo.db
crm-r-us serve --quiet
```

| Endpoint | Purpose |
| --- | --- |
| `POST /mcp` | MCP streamable HTTP endpoint. |
| `GET /health` | Liveness, active session count, and live CRM stats. |

While it runs, `serve` prints every request to stderr so you can narrate a demo
from the console:

```text
time      client          session   event
00:39:26  192.168.1.25    1234ae1e  session opened
00:39:26  192.168.1.25    1234ae1e  call tools/list 4ms
00:39:26  192.168.1.25    1234ae1e  call demo_seed 41ms
00:39:26  192.168.1.25    1234ae1e  call deal_advance_stage 1ms
00:39:27  127.0.0.1       -         call GET /health 0ms
```

Each line carries the client IP, the first 8 characters of the MCP session id,
the CRM verb, and how long it took. Session opens, client disconnects, rejected
requests, and reaped sessions appear on the same stream. Pass `--quiet` to turn
the per-request lines off and keep only the startup banner.

`0.0.0.0` publishes the CRM to every machine that can reach this host, with no
authentication. Windows Firewall may still block inbound access from another
machine; allow the port yourself if you want remote clients.

Sessions are held in memory. MCP clients often disconnect without sending
`DELETE /mcp`, so idle sessions are closed after 4 hours. See the measurement
note in `src/service.ts` before changing that number.

## Register with Copilot CLI

```bash
copilot mcp add crm-r-us -- crm-r-us mcp-server
```

Or inspect the config JSON:

```bash
crm-r-us mcp-config
```

## Commands

```bash
crm-r-us --help
crm-r-us doctor --json
crm-r-us schema
crm-r-us mcp-config
crm-r-us serve                      # HTTP service on 0.0.0.0:3737
crm-r-us mcp-server                 # stdio, default database at ~/.crm-r-us/crm.db
crm-r-us mcp-server --db ./demo.db  # any other SQLite file
crm-r-us mcp-schema
crm-r-us mcp-call demo_seed
crm-r-us update --json
```

## Data

All state lives in one SQLite file. The default is `~/.crm-r-us/crm.db`, created
on first start. Pass `--db <path>` to `crm-r-us serve` or `crm-r-us mcp-server`
for a different file, or `:memory:` for a database that disappears on shutdown.
Every HTTP session shares one database, so a record written by one client is
immediately visible to the next.

There is no authentication and no authorization. Any client that can start the
process, or reach the port, gets full read and write access. This is a local
demo server.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `ping` | Return a pong response for MCP health checks. |
| `account_create` | Create a CRM account (company). |
| `account_update` | Update supplied fields on an account. |
| `account_get` | Return an account with contacts, open deals, pipeline value, and open task count. |
| `account_search` | Search accounts by text, industry, or owner. |
| `account_delete` | Delete an account and cascade to its children. |
| `contact_create` | Create a contact, optionally linked to an account. |
| `contact_update` | Update supplied fields on a contact. |
| `contact_get` | Return a contact with its account, open deals, and recent activities. |
| `contact_search` | Search contacts by text or account. |
| `contact_delete` | Delete a contact and cascade to its activities and tasks. |
| `deal_create` | Create a pipeline deal. |
| `deal_update` | Update supplied fields on a deal. |
| `deal_get` | Return a deal with account, contact, recent activities, and open tasks. |
| `deal_search` | Search deals by text, account, stage, status, owner, or amount. |
| `deal_advance_stage` | Move an open deal forward one stage, or to a later stage. |
| `deal_close` | Close an open deal as won or lost with a reason. |
| `deal_delete` | Delete a deal and cascade to its activities and tasks. |
| `activity_log` | Log a call, email, meeting, or note. |
| `activity_list` | List activities newest first with filters. |
| `task_create` | Create a follow-up task. |
| `task_complete` | Mark an open task done with an outcome note. |
| `task_list` | List tasks by due date with filters. |
| `task_delete` | Delete a task. |
| `report_pipeline` | Open pipeline by stage with raw and weighted value, plus top deals. |
| `report_stats` | Record counts, won and lost value, win rate, and task counts. |
| `demo_seed` | Load the demo dataset: 8 accounts, 18 contacts, 12 deals, tasks, activities. |
| `demo_reset` | Delete every record and leave an empty database. |

Deal stages run `lead`, `qualified`, `proposal`, `negotiation`, then
`closed-won` or `closed-lost`. Each stage sets a default win probability that
`report_pipeline` uses for weighted value. An explicit `probability` overrides it.

Every tool returns one JSON text block: `{"ok":true,"data":...}` on success, or
`{"ok":false,"error":{"code","message"},"hint":...}` on failure.

## Demo script

```bash
crm-r-us mcp-call demo_seed
crm-r-us mcp-call report_pipeline
crm-r-us mcp-call deal_search '{"status":"open","owner":"dana"}'
crm-r-us mcp-call report_stats
crm-r-us mcp-call demo_reset
```

## Conventions

- **Stdio discipline.** Do not write logs or banners to stdout from server code.
  The MCP protocol owns stdout.
- **Compact JSON text results.** Tool handlers return `content[0].text` as a
  JSON string with only the fields the next agent needs.
- **Registry first.** `src/registry.ts` drives `crm-r-us schema`, docs, and
  parity tests.
- **SDK dependency is intentional.** `@modelcontextprotocol/sdk` is the only
  extra runtime dependency over the standard `create-repo` baseline.
- **SQLite comes from Node.** Storage uses the built-in `node:sqlite` module, so
  the server needs no native build step. Node prints one experimental warning to
  stderr at startup, which does not touch the stdout protocol channel.

## Project structure

```
src/
  cli.ts
  server.ts
  registry.ts
  crm/
    db.ts       # schema, migration, connection
    store.ts    # CRM operations and reports
    seed.ts     # demo dataset
  mcp/
    format.ts   # compact JSON text results
    tools.ts    # MCP tool surface
  commands/
    mcpConfig.ts
    mcpDebug.ts
test/
  unit/
```

## Development

```bash
npm run build
npm run lint
npm test
npm run clean
```

## License

MIT
