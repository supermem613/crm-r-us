import { newId, nowIso, type Db } from "./db.js";

export class CrmError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "CrmError";
    this.code = code;
    this.hint = hint;
  }
}

export const DEAL_STAGES = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "closed-won",
  "closed-lost",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const OPEN_DEAL_STAGES: DealStage[] = ["lead", "qualified", "proposal", "negotiation"];

export const ACTIVITY_TYPES = ["call", "email", "meeting", "note"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// Default probability applied when a deal enters a stage and the caller did not
// set one. Overwritten by any explicit probability on create or update.
const STAGE_PROBABILITY: Record<DealStage, number> = {
  "lead": 10,
  "qualified": 25,
  "proposal": 50,
  "negotiation": 75,
  "closed-won": 100,
  "closed-lost": 0,
};

// The seeded demo dataset's largest single list is 18 contacts, so a default of
// 25 returns a whole demo entity list in one call while keeping a response
// under a few KB. Raise `limit` explicitly for bigger data.
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;

export interface Account {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  owner: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  accountId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  name: string;
  accountId: string | null;
  contactId: string | null;
  amount: number;
  currency: string;
  stage: DealStage;
  status: "open" | "won" | "lost";
  probability: number;
  expectedCloseDate: string | null;
  owner: string | null;
  notes: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  accountId: string | null;
  contactId: string | null;
  dealId: string | null;
  owner: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  status: "open" | "done";
  priority: TaskPriority;
  dueDate: string | null;
  assignee: string | null;
  notes: string | null;
  accountId: string | null;
  contactId: string | null;
  dealId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;
type Param = string | number | null;

function text(value: unknown): string {
  return String(value);
}

function optText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function mapAccount(row: Row): Account {
  return {
    id: text(row.id),
    name: text(row.name),
    industry: optText(row.industry),
    website: optText(row.website),
    phone: optText(row.phone),
    owner: optText(row.owner),
    notes: optText(row.notes),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapContact(row: Row): Contact {
  return {
    id: text(row.id),
    accountId: optText(row.account_id),
    firstName: text(row.first_name),
    lastName: text(row.last_name),
    email: optText(row.email),
    phone: optText(row.phone),
    title: optText(row.title),
    notes: optText(row.notes),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapDeal(row: Row): Deal {
  return {
    id: text(row.id),
    name: text(row.name),
    accountId: optText(row.account_id),
    contactId: optText(row.contact_id),
    amount: num(row.amount),
    currency: text(row.currency),
    stage: text(row.stage) as DealStage,
    status: text(row.status) as Deal["status"],
    probability: num(row.probability),
    expectedCloseDate: optText(row.expected_close_date),
    owner: optText(row.owner),
    notes: optText(row.notes),
    closedAt: optText(row.closed_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapActivity(row: Row): Activity {
  return {
    id: text(row.id),
    type: text(row.type) as ActivityType,
    subject: text(row.subject),
    body: optText(row.body),
    accountId: optText(row.account_id),
    contactId: optText(row.contact_id),
    dealId: optText(row.deal_id),
    owner: optText(row.owner),
    occurredAt: text(row.occurred_at),
    createdAt: text(row.created_at),
  };
}

function mapTask(row: Row): Task {
  return {
    id: text(row.id),
    title: text(row.title),
    status: text(row.status) as Task["status"],
    priority: text(row.priority) as TaskPriority,
    dueDate: optText(row.due_date),
    assignee: optText(row.assignee),
    notes: optText(row.notes),
    accountId: optText(row.account_id),
    contactId: optText(row.contact_id),
    dealId: optText(row.deal_id),
    completedAt: optText(row.completed_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function clampLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

function like(term: string): string {
  return `%${term}%`;
}

function requireRow(db: Db, table: string, id: string): Row {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
  if (row === undefined) {
    throw new CrmError("not_found", `No ${table.replace(/s$/, "")} with id "${id}".`, `Use ${table.replace(/s$/, "")}_search to find a valid id.`);
  }
  return row;
}

function assertExists(db: Db, table: string, id: string | null | undefined): void {
  if (id === null || id === undefined) {
    return;
  }
  requireRow(db, table, id);
}

/** Builds an UPDATE ... SET clause from the defined keys of a patch object. */
function applyPatch(
  db: Db,
  table: string,
  id: string,
  columns: Record<string, Param | undefined>,
): void {
  const entries = Object.entries(columns).filter(([, value]) => value !== undefined) as [string, Param][];
  const sets = entries.map(([column]) => `${column} = ?`);
  const params: Param[] = entries.map(([, value]) => value);
  sets.push("updated_at = ?");
  params.push(nowIso());
  params.push(id);
  db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

/* ------------------------------------------------------------------ accounts */

export interface AccountInput {
  name: string;
  industry?: string;
  website?: string;
  phone?: string;
  owner?: string;
  notes?: string;
}

export function createAccount(db: Db, input: AccountInput): Account {
  const id = newId("acc");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO accounts (id, name, industry, website, phone, owner, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.industry ?? null,
    input.website ?? null,
    input.phone ?? null,
    input.owner ?? null,
    input.notes ?? null,
    ts,
    ts,
  );
  return mapAccount(requireRow(db, "accounts", id));
}

export function updateAccount(db: Db, id: string, patch: Partial<AccountInput>): Account {
  requireRow(db, "accounts", id);
  applyPatch(db, "accounts", id, {
    name: patch.name,
    industry: patch.industry,
    website: patch.website,
    phone: patch.phone,
    owner: patch.owner,
    notes: patch.notes,
  });
  return mapAccount(requireRow(db, "accounts", id));
}

export interface AccountDetail extends Account {
  contacts: Contact[];
  openDeals: Deal[];
  openPipeline: number;
  openTaskCount: number;
}

export function getAccount(db: Db, id: string): AccountDetail {
  const account = mapAccount(requireRow(db, "accounts", id));
  const contacts = (db.prepare(`SELECT * FROM contacts WHERE account_id = ? ORDER BY last_name`).all(id) as Row[]).map(mapContact);
  const openDeals = (
    db.prepare(`SELECT * FROM deals WHERE account_id = ? AND status = 'open' ORDER BY amount DESC`).all(id) as Row[]
  ).map(mapDeal);
  const openTaskCount = num(
    (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE account_id = ? AND status = 'open'`).get(id) as Row).n,
  );
  return {
    ...account,
    contacts,
    openDeals,
    openPipeline: openDeals.reduce((total, deal) => total + deal.amount, 0),
    openTaskCount,
  };
}

export interface AccountQuery {
  query?: string;
  industry?: string;
  owner?: string;
  limit?: number;
}

export function searchAccounts(db: Db, filter: AccountQuery = {}): Account[] {
  const where: string[] = [];
  const params: Param[] = [];
  if (filter.query) {
    where.push("(name LIKE ? OR industry LIKE ? OR website LIKE ? OR notes LIKE ?)");
    params.push(like(filter.query), like(filter.query), like(filter.query), like(filter.query));
  }
  if (filter.industry) {
    where.push("industry = ?");
    params.push(filter.industry);
  }
  if (filter.owner) {
    where.push("owner = ?");
    params.push(filter.owner);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM accounts ${clause} ORDER BY name LIMIT ?`)
    .all(...params, clampLimit(filter.limit)) as Row[];
  return rows.map(mapAccount);
}

export interface DeleteResult {
  id: string;
  deleted: true;
  cascaded: Record<string, number>;
}

export function deleteAccount(db: Db, id: string): DeleteResult {
  requireRow(db, "accounts", id);
  const cascaded = {
    contacts: countWhere(db, "contacts", "account_id", id),
    deals: countWhere(db, "deals", "account_id", id),
    activities: countWhere(db, "activities", "account_id", id),
    tasks: countWhere(db, "tasks", "account_id", id),
  };
  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
  return { id, deleted: true, cascaded };
}

function countWhere(db: Db, table: string, column: string, value: string): number {
  return num((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(value) as Row).n);
}

/* ------------------------------------------------------------------ contacts */

export interface ContactInput {
  accountId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  title?: string;
  notes?: string;
}

export function createContact(db: Db, input: ContactInput): Contact {
  assertExists(db, "accounts", input.accountId);
  const id = newId("con");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO contacts (id, account_id, first_name, last_name, email, phone, title, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.accountId ?? null,
    input.firstName,
    input.lastName,
    input.email ?? null,
    input.phone ?? null,
    input.title ?? null,
    input.notes ?? null,
    ts,
    ts,
  );
  return mapContact(requireRow(db, "contacts", id));
}

export function updateContact(db: Db, id: string, patch: Partial<ContactInput>): Contact {
  requireRow(db, "contacts", id);
  assertExists(db, "accounts", patch.accountId);
  applyPatch(db, "contacts", id, {
    account_id: patch.accountId,
    first_name: patch.firstName,
    last_name: patch.lastName,
    email: patch.email,
    phone: patch.phone,
    title: patch.title,
    notes: patch.notes,
  });
  return mapContact(requireRow(db, "contacts", id));
}

export interface ContactDetail extends Contact {
  account: Account | null;
  openDeals: Deal[];
  recentActivities: Activity[];
}

export function getContact(db: Db, id: string): ContactDetail {
  const contact = mapContact(requireRow(db, "contacts", id));
  const account = contact.accountId === null ? null : mapAccount(requireRow(db, "accounts", contact.accountId));
  const openDeals = (
    db.prepare(`SELECT * FROM deals WHERE contact_id = ? AND status = 'open' ORDER BY amount DESC`).all(id) as Row[]
  ).map(mapDeal);
  const recentActivities = (
    db.prepare(`SELECT * FROM activities WHERE contact_id = ? ORDER BY occurred_at DESC LIMIT 5`).all(id) as Row[]
  ).map(mapActivity);
  return { ...contact, account, openDeals, recentActivities };
}

export interface ContactQuery {
  query?: string;
  accountId?: string;
  limit?: number;
}

export function searchContacts(db: Db, filter: ContactQuery = {}): Contact[] {
  const where: string[] = [];
  const params: Param[] = [];
  if (filter.query) {
    where.push("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR title LIKE ? OR notes LIKE ?)");
    for (let i = 0; i < 5; i++) {
      params.push(like(filter.query));
    }
  }
  if (filter.accountId) {
    where.push("account_id = ?");
    params.push(filter.accountId);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM contacts ${clause} ORDER BY last_name, first_name LIMIT ?`)
    .all(...params, clampLimit(filter.limit)) as Row[];
  return rows.map(mapContact);
}

export function deleteContact(db: Db, id: string): DeleteResult {
  requireRow(db, "contacts", id);
  const cascaded = {
    activities: countWhere(db, "activities", "contact_id", id),
    tasks: countWhere(db, "tasks", "contact_id", id),
  };
  db.prepare(`DELETE FROM contacts WHERE id = ?`).run(id);
  return { id, deleted: true, cascaded };
}

/* --------------------------------------------------------------------- deals */

export interface DealInput {
  name: string;
  accountId?: string;
  contactId?: string;
  amount?: number;
  currency?: string;
  stage?: DealStage;
  probability?: number;
  expectedCloseDate?: string;
  owner?: string;
  notes?: string;
}

function statusForStage(stage: DealStage): Deal["status"] {
  if (stage === "closed-won") {
    return "won";
  }
  if (stage === "closed-lost") {
    return "lost";
  }
  return "open";
}

export function createDeal(db: Db, input: DealInput): Deal {
  assertExists(db, "accounts", input.accountId);
  assertExists(db, "contacts", input.contactId);
  const stage = input.stage ?? "lead";
  const id = newId("deal");
  const ts = nowIso();
  const status = statusForStage(stage);
  db.prepare(
    `INSERT INTO deals (id, name, account_id, contact_id, amount, currency, stage, status, probability,
                        expected_close_date, owner, notes, closed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.accountId ?? null,
    input.contactId ?? null,
    input.amount ?? 0,
    input.currency ?? "USD",
    stage,
    status,
    input.probability ?? STAGE_PROBABILITY[stage],
    input.expectedCloseDate ?? null,
    input.owner ?? null,
    input.notes ?? null,
    status === "open" ? null : ts,
    ts,
    ts,
  );
  return mapDeal(requireRow(db, "deals", id));
}

export function updateDeal(db: Db, id: string, patch: Partial<DealInput>): Deal {
  requireRow(db, "deals", id);
  assertExists(db, "accounts", patch.accountId);
  assertExists(db, "contacts", patch.contactId);
  const stagePatch = patch.stage;
  applyPatch(db, "deals", id, {
    name: patch.name,
    account_id: patch.accountId,
    contact_id: patch.contactId,
    amount: patch.amount,
    currency: patch.currency,
    stage: stagePatch,
    status: stagePatch === undefined ? undefined : statusForStage(stagePatch),
    probability: patch.probability ?? (stagePatch === undefined ? undefined : STAGE_PROBABILITY[stagePatch]),
    expected_close_date: patch.expectedCloseDate,
    owner: patch.owner,
    notes: patch.notes,
    closed_at: stagePatch === undefined || statusForStage(stagePatch) === "open" ? undefined : nowIso(),
  });
  return mapDeal(requireRow(db, "deals", id));
}

export interface DealDetail extends Deal {
  account: Account | null;
  contact: Contact | null;
  recentActivities: Activity[];
  openTasks: Task[];
}

export function getDeal(db: Db, id: string): DealDetail {
  const deal = mapDeal(requireRow(db, "deals", id));
  return {
    ...deal,
    account: deal.accountId === null ? null : mapAccount(requireRow(db, "accounts", deal.accountId)),
    contact: deal.contactId === null ? null : mapContact(requireRow(db, "contacts", deal.contactId)),
    recentActivities: (
      db.prepare(`SELECT * FROM activities WHERE deal_id = ? ORDER BY occurred_at DESC LIMIT 5`).all(id) as Row[]
    ).map(mapActivity),
    openTasks: (
      db.prepare(`SELECT * FROM tasks WHERE deal_id = ? AND status = 'open' ORDER BY due_date`).all(id) as Row[]
    ).map(mapTask),
  };
}

export interface DealQuery {
  query?: string;
  accountId?: string;
  stage?: DealStage;
  status?: Deal["status"];
  owner?: string;
  minAmount?: number;
  limit?: number;
}

export function searchDeals(db: Db, filter: DealQuery = {}): Deal[] {
  const where: string[] = [];
  const params: Param[] = [];
  if (filter.query) {
    where.push("(name LIKE ? OR notes LIKE ?)");
    params.push(like(filter.query), like(filter.query));
  }
  if (filter.accountId) {
    where.push("account_id = ?");
    params.push(filter.accountId);
  }
  if (filter.stage) {
    where.push("stage = ?");
    params.push(filter.stage);
  }
  if (filter.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter.owner) {
    where.push("owner = ?");
    params.push(filter.owner);
  }
  if (filter.minAmount !== undefined) {
    where.push("amount >= ?");
    params.push(filter.minAmount);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM deals ${clause} ORDER BY amount DESC LIMIT ?`)
    .all(...params, clampLimit(filter.limit)) as Row[];
  return rows.map(mapDeal);
}

export function advanceDealStage(db: Db, id: string, toStage?: DealStage): Deal {
  const deal = mapDeal(requireRow(db, "deals", id));
  if (deal.status !== "open") {
    throw new CrmError(
      "deal_closed",
      `Deal "${deal.name}" is already ${deal.status}.`,
      "Use deal_update to reopen it at an open stage before advancing.",
    );
  }
  const currentIndex = OPEN_DEAL_STAGES.indexOf(deal.stage);
  let next: DealStage;
  if (toStage !== undefined) {
    if (OPEN_DEAL_STAGES.indexOf(toStage) <= currentIndex) {
      throw new CrmError(
        "stage_not_forward",
        `Stage "${toStage}" does not advance a deal that is at "${deal.stage}".`,
        "Use deal_update to move a deal backwards, or deal_close to close it.",
      );
    }
    next = toStage;
  } else {
    const nextStage = OPEN_DEAL_STAGES[currentIndex + 1];
    if (nextStage === undefined) {
      throw new CrmError(
        "stage_final",
        `Deal "${deal.name}" is at the last open stage "${deal.stage}".`,
        "Use deal_close with outcome won or lost.",
      );
    }
    next = nextStage;
  }
  applyPatch(db, "deals", id, { stage: next, probability: STAGE_PROBABILITY[next] });
  return mapDeal(requireRow(db, "deals", id));
}

export function closeDeal(db: Db, id: string, outcome: "won" | "lost", reason?: string): Deal {
  const deal = mapDeal(requireRow(db, "deals", id));
  if (deal.status !== "open") {
    throw new CrmError("deal_closed", `Deal "${deal.name}" is already ${deal.status}.`);
  }
  const stage: DealStage = outcome === "won" ? "closed-won" : "closed-lost";
  applyPatch(db, "deals", id, {
    stage,
    status: outcome,
    probability: STAGE_PROBABILITY[stage],
    closed_at: nowIso(),
    notes: reason === undefined ? undefined : [deal.notes, `[${outcome}] ${reason}`].filter(Boolean).join("\n"),
  });
  return mapDeal(requireRow(db, "deals", id));
}

export function deleteDeal(db: Db, id: string): DeleteResult {
  requireRow(db, "deals", id);
  const cascaded = {
    activities: countWhere(db, "activities", "deal_id", id),
    tasks: countWhere(db, "tasks", "deal_id", id),
  };
  db.prepare(`DELETE FROM deals WHERE id = ?`).run(id);
  return { id, deleted: true, cascaded };
}

/* ---------------------------------------------------------------- activities */

export interface ActivityInput {
  type: ActivityType;
  subject: string;
  body?: string;
  accountId?: string;
  contactId?: string;
  dealId?: string;
  owner?: string;
  occurredAt?: string;
}

export function logActivity(db: Db, input: ActivityInput): Activity {
  assertExists(db, "accounts", input.accountId);
  assertExists(db, "contacts", input.contactId);
  assertExists(db, "deals", input.dealId);
  if (!input.accountId && !input.contactId && !input.dealId) {
    throw new CrmError(
      "unlinked_activity",
      "An activity must reference at least one of accountId, contactId, or dealId.",
      "Pass the id of the account, contact, or deal the activity belongs to.",
    );
  }
  const id = newId("act");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO activities (id, type, subject, body, account_id, contact_id, deal_id, owner, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.type,
    input.subject,
    input.body ?? null,
    input.accountId ?? null,
    input.contactId ?? null,
    input.dealId ?? null,
    input.owner ?? null,
    input.occurredAt ?? ts,
    ts,
  );
  return mapActivity(requireRow(db, "activities", id));
}

export interface ActivityQuery {
  query?: string;
  type?: ActivityType;
  accountId?: string;
  contactId?: string;
  dealId?: string;
  since?: string;
  limit?: number;
}

export function listActivities(db: Db, filter: ActivityQuery = {}): Activity[] {
  const where: string[] = [];
  const params: Param[] = [];
  if (filter.query) {
    where.push("(subject LIKE ? OR body LIKE ?)");
    params.push(like(filter.query), like(filter.query));
  }
  if (filter.type) {
    where.push("type = ?");
    params.push(filter.type);
  }
  if (filter.accountId) {
    where.push("account_id = ?");
    params.push(filter.accountId);
  }
  if (filter.contactId) {
    where.push("contact_id = ?");
    params.push(filter.contactId);
  }
  if (filter.dealId) {
    where.push("deal_id = ?");
    params.push(filter.dealId);
  }
  if (filter.since) {
    where.push("occurred_at >= ?");
    params.push(filter.since);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM activities ${clause} ORDER BY occurred_at DESC LIMIT ?`)
    .all(...params, clampLimit(filter.limit)) as Row[];
  return rows.map(mapActivity);
}

/* --------------------------------------------------------------------- tasks */

export interface TaskInput {
  title: string;
  dueDate?: string;
  priority?: TaskPriority;
  assignee?: string;
  notes?: string;
  accountId?: string;
  contactId?: string;
  dealId?: string;
}

export function createTask(db: Db, input: TaskInput): Task {
  assertExists(db, "accounts", input.accountId);
  assertExists(db, "contacts", input.contactId);
  assertExists(db, "deals", input.dealId);
  const id = newId("task");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO tasks (id, title, status, priority, due_date, assignee, notes, account_id, contact_id, deal_id,
                        completed_at, created_at, updated_at)
     VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    input.title,
    input.priority ?? "normal",
    input.dueDate ?? null,
    input.assignee ?? null,
    input.notes ?? null,
    input.accountId ?? null,
    input.contactId ?? null,
    input.dealId ?? null,
    ts,
    ts,
  );
  return mapTask(requireRow(db, "tasks", id));
}

export function completeTask(db: Db, id: string, outcomeNote?: string): Task {
  const task = mapTask(requireRow(db, "tasks", id));
  if (task.status === "done") {
    throw new CrmError("task_done", `Task "${task.title}" is already done.`);
  }
  applyPatch(db, "tasks", id, {
    status: "done",
    completed_at: nowIso(),
    notes: outcomeNote === undefined ? undefined : [task.notes, outcomeNote].filter(Boolean).join("\n"),
  });
  return mapTask(requireRow(db, "tasks", id));
}

export interface TaskQuery {
  status?: Task["status"];
  assignee?: string;
  accountId?: string;
  dealId?: string;
  dueBefore?: string;
  limit?: number;
}

export function listTasks(db: Db, filter: TaskQuery = {}): Task[] {
  const where: string[] = [];
  const params: Param[] = [];
  if (filter.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter.assignee) {
    where.push("assignee = ?");
    params.push(filter.assignee);
  }
  if (filter.accountId) {
    where.push("account_id = ?");
    params.push(filter.accountId);
  }
  if (filter.dealId) {
    where.push("deal_id = ?");
    params.push(filter.dealId);
  }
  if (filter.dueBefore) {
    where.push("due_date IS NOT NULL AND due_date <= ?");
    params.push(filter.dueBefore);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM tasks ${clause} ORDER BY (due_date IS NULL), due_date, priority DESC LIMIT ?`)
    .all(...params, clampLimit(filter.limit)) as Row[];
  return rows.map(mapTask);
}

export function deleteTask(db: Db, id: string): DeleteResult {
  requireRow(db, "tasks", id);
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  return { id, deleted: true, cascaded: {} };
}

/* ------------------------------------------------------------------- reports */

export interface PipelineStage {
  stage: DealStage;
  dealCount: number;
  value: number;
  weightedValue: number;
}

export interface PipelineReport {
  currency: string;
  stages: PipelineStage[];
  openDealCount: number;
  openValue: number;
  weightedValue: number;
  topDeals: Deal[];
}

export function pipelineReport(db: Db, filter: { owner?: string; accountId?: string } = {}): PipelineReport {
  const where: string[] = ["status = 'open'"];
  const params: Param[] = [];
  if (filter.owner) {
    where.push("owner = ?");
    params.push(filter.owner);
  }
  if (filter.accountId) {
    where.push("account_id = ?");
    params.push(filter.accountId);
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const rows = db
    .prepare(
      `SELECT stage, COUNT(*) AS deal_count, COALESCE(SUM(amount), 0) AS value,
              COALESCE(SUM(amount * probability / 100.0), 0) AS weighted
       FROM deals ${clause} GROUP BY stage`,
    )
    .all(...params) as Row[];

  const byStage = new Map(rows.map((row) => [text(row.stage), row]));
  const stages: PipelineStage[] = OPEN_DEAL_STAGES.map((stage) => {
    const row = byStage.get(stage);
    return {
      stage,
      dealCount: row ? num(row.deal_count) : 0,
      value: row ? round2(num(row.value)) : 0,
      weightedValue: row ? round2(num(row.weighted)) : 0,
    };
  });

  const topDeals = (
    db.prepare(`SELECT * FROM deals ${clause} ORDER BY amount DESC LIMIT 5`).all(...params) as Row[]
  ).map(mapDeal);

  return {
    currency: topDeals[0]?.currency ?? "USD",
    stages,
    openDealCount: stages.reduce((total, stage) => total + stage.dealCount, 0),
    openValue: round2(stages.reduce((total, stage) => total + stage.value, 0)),
    weightedValue: round2(stages.reduce((total, stage) => total + stage.weightedValue, 0)),
    topDeals,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface CrmStats {
  accounts: number;
  contacts: number;
  deals: { open: number; won: number; lost: number };
  wonValue: number;
  lostValue: number;
  winRate: number | null;
  activities: number;
  tasks: { open: number; done: number; overdue: number };
}

export function crmStats(db: Db, asOf: string = nowIso()): CrmStats {
  const count = (sql: string, ...params: Param[]): number =>
    num((db.prepare(sql).get(...params) as Row).n);
  const sum = (sql: string, ...params: Param[]): number =>
    round2(num((db.prepare(sql).get(...params) as Row).total));

  const won = count(`SELECT COUNT(*) AS n FROM deals WHERE status = 'won'`);
  const lost = count(`SELECT COUNT(*) AS n FROM deals WHERE status = 'lost'`);
  const closed = won + lost;

  return {
    accounts: count(`SELECT COUNT(*) AS n FROM accounts`),
    contacts: count(`SELECT COUNT(*) AS n FROM contacts`),
    deals: {
      open: count(`SELECT COUNT(*) AS n FROM deals WHERE status = 'open'`),
      won,
      lost,
    },
    wonValue: sum(`SELECT COALESCE(SUM(amount), 0) AS total FROM deals WHERE status = 'won'`),
    lostValue: sum(`SELECT COALESCE(SUM(amount), 0) AS total FROM deals WHERE status = 'lost'`),
    winRate: closed === 0 ? null : Math.round((won / closed) * 100),
    activities: count(`SELECT COUNT(*) AS n FROM activities`),
    tasks: {
      open: count(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'`),
      done: count(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'done'`),
      overdue: count(
        `SELECT COUNT(*) AS n FROM tasks WHERE status = 'open' AND due_date IS NOT NULL AND due_date < ?`,
        asOf,
      ),
    },
  };
}
