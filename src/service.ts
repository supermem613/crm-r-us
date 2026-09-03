import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import chalk from "chalk";
import { defaultDbPath, openDb, type Db } from "./crm/db.js";
import { crmStats } from "./crm/store.js";
import { createCrmRUsServer } from "./server.js";

export interface ServeOptions {
  port: number;
  host: string;
  dbPath?: string;
  /** Already-open database. Takes precedence over dbPath. Used by tests. */
  db?: Db;
  /** MCP endpoint path. */
  path?: string;
  /** Milliseconds a session may sit idle before it is closed. */
  idleTimeoutMs?: number;
  /** Milliseconds between idle sweeps. */
  sweepIntervalMs?: number;
  /** Print per-request activity to stderr. Default true. */
  log?: boolean;
}

export interface RunningService {
  http: Server;
  port: number;
  host: string;
  sessionCount: () => number;
  /** Closes sessions idle past the timeout. Returns how many were closed. */
  sweepIdleSessions: (now?: number) => number;
  close: () => Promise<void>;
}

const SESSION_HEADER = "mcp-session-id";

// A streamable HTTP session lives until the client sends DELETE, and MCP
// clients commonly disconnect without one, so idle sessions must be reaped or
// the map grows for the life of the service.
//
// Measured over 328 consecutive agent tool-call gaps in the 7 days to
// 2026-09-02: p50 8s, p95 99s, p99 4949s (82 min), max 74073s (20.6h). A live
// human-in-the-loop session therefore idles well past an hour, so the timeout
// sits at 4h, roughly 3x the p99, and only the overnight tail is reclaimed.
// Re-measure before lowering this: a too-short timeout kills sessions in use.
const DEFAULT_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

interface Session {
  transport: StreamableHTTPServerTransport;
  lastSeenAt: number;
}

function clientIp(req: IncomingMessage): string {
  const raw = req.socket.remoteAddress ?? "unknown";
  // Node reports IPv4 peers on a dual-stack socket as ::ffff:192.168.1.25.
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

function shortSession(sessionId: string | undefined): string {
  return sessionId === undefined ? "-".padEnd(8) : sessionId.slice(0, 8);
}

/** Summarizes a JSON-RPC body as the verb an operator wants to read. */
export function describeCall(body: unknown): string {
  const messages = Array.isArray(body) ? body : [body];
  const parts: string[] = [];
  for (const message of messages) {
    if (typeof message !== "object" || message === null) {
      continue;
    }
    const { method, params } = message as { method?: unknown; params?: unknown };
    if (typeof method !== "string") {
      continue;
    }
    const name = (params as { name?: unknown } | undefined)?.name;
    parts.push(method === "tools/call" && typeof name === "string" ? name : method);
  }
  return parts.length === 0 ? "?" : parts.join(", ");
}

class ActivityLog {
  constructor(private readonly enabled: boolean) {}

  private write(color: (value: string) => string, ip: string, sessionId: string | undefined, label: string, detail: string): void {
    if (!this.enabled) {
      return;
    }
    const time = new Date().toISOString().slice(11, 19);
    const line = `${chalk.dim(time)}  ${ip.padEnd(15)} ${chalk.dim(shortSession(sessionId))}  ${color(label)} ${detail}`;
    process.stderr.write(`${line}\n`);
  }

  call(ip: string, sessionId: string | undefined, verb: string, durationMs: number): void {
    this.write(chalk.cyan, ip, sessionId, "call", `${verb} ${chalk.dim(`${durationMs}ms`)}`);
  }

  session(ip: string, sessionId: string | undefined, event: string): void {
    this.write(chalk.green, ip, sessionId, "session", event);
  }

  reject(ip: string, sessionId: string | undefined, reason: string): void {
    this.write(chalk.yellow, ip, sessionId, "reject", reason);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function jsonRpcError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sessionIdOf(req: IncomingMessage): string | undefined {
  const value = req.headers[SESSION_HEADER];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Starts the CRM as a long-lived streamable HTTP MCP service.
 *
 * Each MCP session gets its own transport and McpServer, because the SDK binds
 * one server to one transport. All sessions share a single SQLite connection so
 * a record created in one client is visible to the next.
 *
 * There is no authentication. Any client that can reach the port has full read
 * and write access to the CRM. This is a local demo service.
 */
export async function startCrmService(options: ServeOptions): Promise<RunningService> {
  const endpoint = options.path ?? "/mcp";
  const db = options.db ?? openDb(options.dbPath ?? defaultDbPath());
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const activity = new ActivityLog(options.log ?? true);
  const sessions = new Map<string, Session>();

  function touch(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session !== undefined) {
      session.lastSeenAt = Date.now();
    }
  }

  function sweepIdleSessions(now: number = Date.now()): number {
    let closed = 0;
    for (const [id, session] of [...sessions]) {
      if (now - session.lastSeenAt >= idleTimeoutMs) {
        sessions.delete(id);
        closed += 1;
        activity.session("reaper", id, `closed after idling ${Math.round((now - session.lastSeenAt) / 1000)}s`);
        void session.transport.close();
      }
    }
    return closed;
  }

  async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    const sessionId = sessionIdOf(req);
    const existing = sessionId === undefined ? undefined : sessions.get(sessionId);
    const ip = clientIp(req);

    if (existing !== undefined && sessionId !== undefined) {
      touch(sessionId);
      const startedAt = Date.now();
      await existing.transport.handleRequest(req, res, body);
      activity.call(ip, sessionId, describeCall(body), Date.now() - startedAt);
      return;
    }

    if (sessionId !== undefined) {
      activity.reject(ip, sessionId, "unknown session");
      jsonRpcError(res, 404, `Unknown MCP session "${sessionId}". Initialize a new session.`);
      return;
    }

    if (!isInitializeRequest(body)) {
      activity.reject(ip, undefined, `no session header for ${describeCall(body)}`);
      jsonRpcError(res, 400, `Missing ${SESSION_HEADER} header. Send an initialize request first.`);
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, lastSeenAt: Date.now() });
        activity.session(ip, id, "opened");
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
        activity.session(ip, id, "closed by client");
      },
    });
    transport.onclose = () => {
      if (transport.sessionId !== undefined) {
        sessions.delete(transport.sessionId);
      }
    };

    await createCrmRUsServer({ db }).connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function handleSessionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = sessionIdOf(req);
    const session = sessionId === undefined ? undefined : sessions.get(sessionId);
    const ip = clientIp(req);
    if (session === undefined || sessionId === undefined) {
      activity.reject(ip, sessionId, `${req.method ?? "request"} with unknown session`);
      jsonRpcError(res, 404, `Unknown or missing ${SESSION_HEADER}.`);
      return;
    }
    touch(sessionId);
    if (req.method === "DELETE") {
      activity.session(ip, sessionId, "delete requested");
    }
    await session.transport.handleRequest(req, res);
  }

  const http = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

        if (url.pathname === "/health") {
          activity.call(clientIp(req), undefined, "GET /health", 0);
          sendJson(res, 200, { ok: true, service: "crm-r-us", sessions: sessions.size, stats: crmStats(db) });
          return;
        }

        if (url.pathname !== endpoint) {
          jsonRpcError(res, 404, `No such endpoint. Use POST ${endpoint} or GET /health.`);
          return;
        }

        if (req.method === "POST") {
          await handlePost(req, res);
          return;
        }
        if (req.method === "GET" || req.method === "DELETE") {
          await handleSessionRequest(req, res);
          return;
        }
        jsonRpcError(res, 405, `Method ${req.method ?? "unknown"} is not supported on ${endpoint}.`);
      } catch (err) {
        if (!res.headersSent) {
          jsonRpcError(res, 500, err instanceof Error ? err.message : String(err));
        } else {
          res.end();
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, options.host, () => {
      http.removeListener("error", reject);
      resolve();
    });
  });

  const address = http.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : options.port;

  const sweep = setInterval(() => sweepIdleSessions(), options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
  sweep.unref();

  return {
    http,
    port: boundPort,
    host: options.host,
    sessionCount: () => sessions.size,
    sweepIdleSessions,
    close: async () => {
      clearInterval(sweep);
      for (const session of sessions.values()) {
        await session.transport.close();
      }
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export const DEFAULT_PORT = 3737;
export const DEFAULT_HOST = "0.0.0.0";

export interface ResolvedServeOptions {
  port: number;
  host: string;
  dbPath: string;
  log: boolean;
}

/**
 * Resolves the serve defaults. Kept separate from serveCommand so the defaults
 * can be asserted without binding a real port.
 */
export function resolveServeOptions(
  opts: { port?: string; host?: string; db?: string; quiet?: boolean } = {},
): ResolvedServeOptions {
  const port = opts.port === undefined ? DEFAULT_PORT : Number.parseInt(opts.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port "${opts.port}". Use a number between 1 and 65535.`);
  }
  return {
    port,
    host: opts.host ?? DEFAULT_HOST,
    dbPath: opts.db ?? defaultDbPath(),
    log: opts.quiet !== true,
  };
}

export async function serveCommand(opts: { port?: string; host?: string; db?: string; quiet?: boolean }): Promise<void> {
  const { port, host, dbPath, log } = resolveServeOptions(opts);

  const service = await startCrmService({ port, host, dbPath, log }).catch((err: unknown) => {
    if (err instanceof Error && err.message.includes("EADDRINUSE")) {
      throw new Error(`Port ${port} is already in use. Stop the other server or pass --port <n>.`);
    }
    throw err;
  });

  // Human narration goes to stderr. The HTTP transport owns its own responses,
  // and keeping stdout clean lets the same binary be piped in other contexts.
  process.stderr.write(`${chalk.bold("crm-r-us")} listening on ${chalk.cyan(`http://${host}:${service.port}/mcp`)}\n`);
  process.stderr.write(`  health:   http://${host}:${service.port}/health\n`);
  process.stderr.write(`  database: ${dbPath}\n`);
  process.stderr.write(`  auth:     ${chalk.yellow("none. Any client that can reach this port has full access.")}\n`);
  if (log) {
    process.stderr.write(`\n${chalk.dim("time      client          session   event")}\n`);
  }

  const shutdown = (): void => {
    void service.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
