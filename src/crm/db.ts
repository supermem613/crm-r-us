import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Db = DatabaseSync;

export const MEMORY_DB = ":memory:";

export function defaultDbPath(): string {
  return join(homedir(), ".crm-r-us", "crm.db");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString("hex")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  industry      TEXT,
  website       TEXT,
  phone         TEXT,
  owner         TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id            TEXT PRIMARY KEY,
  account_id    TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  title         TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  account_id          TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id          TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  amount              REAL NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'USD',
  stage               TEXT NOT NULL,
  status              TEXT NOT NULL,
  probability         INTEGER NOT NULL DEFAULT 0,
  expected_close_date TEXT,
  owner               TEXT,
  notes               TEXT,
  closed_at           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT,
  account_id    TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id       TEXT REFERENCES deals(id) ON DELETE CASCADE,
  owner         TEXT,
  occurred_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL,
  priority      TEXT NOT NULL,
  due_date      TEXT,
  assignee      TEXT,
  notes         TEXT,
  account_id    TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id       TEXT REFERENCES deals(id) ON DELETE CASCADE,
  completed_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
CREATE INDEX IF NOT EXISTS idx_deals_account ON deals(account_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_activities_account ON activities(account_id);
CREATE INDEX IF NOT EXISTS idx_activities_deal ON activities(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
`;

export function migrate(db: Db): void {
  db.exec(SCHEMA);
}

export function openDb(path: string = defaultDbPath()): Db {
  if (path !== MEMORY_DB) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  // SQLite disables foreign keys per connection by default, and the CRM relies
  // on ON DELETE CASCADE so child rows never outlive their parent account.
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== MEMORY_DB) {
    db.exec("PRAGMA journal_mode = WAL");
  }
  migrate(db);
  return db;
}

export function resetDb(db: Db): void {
  db.exec(`
    DELETE FROM tasks;
    DELETE FROM activities;
    DELETE FROM deals;
    DELETE FROM contacts;
    DELETE FROM accounts;
  `);
}
