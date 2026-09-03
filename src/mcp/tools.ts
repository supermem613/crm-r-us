import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolTextResult } from "./format.js";
import { resetDb, type Db } from "../crm/db.js";
import { seedDemoData } from "../crm/seed.js";
import {
  ACTIVITY_TYPES,
  CrmError,
  DEAL_STAGES,
  TASK_PRIORITIES,
  advanceDealStage,
  closeDeal,
  completeTask,
  createAccount,
  createContact,
  createDeal,
  createTask,
  crmStats,
  deleteAccount,
  deleteContact,
  deleteDeal,
  deleteTask,
  getAccount,
  getContact,
  getDeal,
  listActivities,
  listTasks,
  logActivity,
  pipelineReport,
  searchAccounts,
  searchContacts,
  searchDeals,
  updateAccount,
  updateContact,
  updateDeal,
} from "../crm/store.js";

/** Runs a CRM operation and renders either an ok envelope or an actionable error. */
function run<T>(operation: () => T) {
  try {
    return toolTextResult({ ok: true, data: operation() });
  } catch (err) {
    if (err instanceof CrmError) {
      return toolTextResult({ ok: false, error: { code: err.code, message: err.message }, hint: err.hint });
    }
    const message = err instanceof Error ? err.message : String(err);
    return toolTextResult({ ok: false, error: { code: "crm_failed", message } });
  }
}

const idField = (label: string) => z.string().min(1).describe(label);
const limitField = z.number().int().min(1).max(200).optional().describe("Maximum rows to return. Default 25.");
const stageField = z.enum(DEAL_STAGES);

const accountFields = {
  name: z.string().min(1).describe("Account (company) name."),
  industry: z.string().optional().describe("Industry, for example Manufacturing."),
  website: z.string().optional().describe("Company website URL."),
  phone: z.string().optional().describe("Main phone number."),
  owner: z.string().optional().describe("Sales rep who owns the account."),
  notes: z.string().optional().describe("Free-form account notes."),
};

const contactFields = {
  accountId: z.string().optional().describe("Account this contact belongs to."),
  firstName: z.string().min(1).describe("Given name."),
  lastName: z.string().min(1).describe("Family name."),
  email: z.string().optional().describe("Email address."),
  phone: z.string().optional().describe("Phone number."),
  title: z.string().optional().describe("Job title."),
  notes: z.string().optional().describe("Free-form contact notes."),
};

const dealFields = {
  name: z.string().min(1).describe("Deal name."),
  accountId: z.string().optional().describe("Account the deal belongs to."),
  contactId: z.string().optional().describe("Primary contact on the deal."),
  amount: z.number().min(0).optional().describe("Deal value. Default 0."),
  currency: z.string().optional().describe("ISO currency code. Default USD."),
  stage: stageField.optional().describe("Pipeline stage. Default lead."),
  probability: z.number().int().min(0).max(100).optional().describe("Win probability percent. Defaults per stage."),
  expectedCloseDate: z.string().optional().describe("Expected close date as YYYY-MM-DD."),
  owner: z.string().optional().describe("Sales rep who owns the deal."),
  notes: z.string().optional().describe("Free-form deal notes."),
};

function optionalShape<T extends z.ZodRawShape>(shape: T) {
  const out: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(shape)) {
    out[key] = value.isOptional() ? value : value.optional();
  }
  return out;
}

export function registerCrmTools(server: McpServer, db: Db): void {
  server.registerTool(
    "ping",
    { title: "Ping", description: "Return a pong response for MCP health checks.", inputSchema: {} },
    async () => toolTextResult({ ok: true, data: { message: "pong" } }),
  );

  /* ---------------------------------------------------------------- accounts */

  server.registerTool(
    "account_create",
    { title: "Create account", description: "Create a CRM account (company).", inputSchema: accountFields },
    async (args) => run(() => createAccount(db, args)),
  );

  server.registerTool(
    "account_update",
    {
      title: "Update account",
      description: "Update fields on an existing account. Only supplied fields change.",
      inputSchema: { id: idField("Account id."), ...optionalShape(accountFields) },
    },
    async ({ id, ...patch }) => run(() => updateAccount(db, id, patch)),
  );

  server.registerTool(
    "account_get",
    {
      title: "Get account",
      description: "Return one account with its contacts, open deals, open pipeline value, and open task count.",
      inputSchema: { id: idField("Account id.") },
    },
    async ({ id }) => run(() => getAccount(db, id)),
  );

  server.registerTool(
    "account_search",
    {
      title: "Search accounts",
      description: "Search accounts by free text, industry, or owner.",
      inputSchema: {
        query: z.string().optional().describe("Text matched against name, industry, website, and notes."),
        industry: z.string().optional().describe("Exact industry filter."),
        owner: z.string().optional().describe("Exact owner filter."),
        limit: limitField,
      },
    },
    async (args) => run(() => searchAccounts(db, args)),
  );

  server.registerTool(
    "account_delete",
    {
      title: "Delete account",
      description: "Delete an account and cascade to its contacts, deals, activities, and tasks.",
      inputSchema: { id: idField("Account id.") },
    },
    async ({ id }) => run(() => deleteAccount(db, id)),
  );

  /* ---------------------------------------------------------------- contacts */

  server.registerTool(
    "contact_create",
    { title: "Create contact", description: "Create a contact, optionally linked to an account.", inputSchema: contactFields },
    async (args) => run(() => createContact(db, args)),
  );

  server.registerTool(
    "contact_update",
    {
      title: "Update contact",
      description: "Update fields on an existing contact. Only supplied fields change.",
      inputSchema: { id: idField("Contact id."), ...optionalShape(contactFields) },
    },
    async ({ id, ...patch }) => run(() => updateContact(db, id, patch)),
  );

  server.registerTool(
    "contact_get",
    {
      title: "Get contact",
      description: "Return one contact with its account, open deals, and five most recent activities.",
      inputSchema: { id: idField("Contact id.") },
    },
    async ({ id }) => run(() => getContact(db, id)),
  );

  server.registerTool(
    "contact_search",
    {
      title: "Search contacts",
      description: "Search contacts by free text or account.",
      inputSchema: {
        query: z.string().optional().describe("Text matched against name, email, title, and notes."),
        accountId: z.string().optional().describe("Restrict to one account."),
        limit: limitField,
      },
    },
    async (args) => run(() => searchContacts(db, args)),
  );

  server.registerTool(
    "contact_delete",
    {
      title: "Delete contact",
      description: "Delete a contact and cascade to its activities and tasks.",
      inputSchema: { id: idField("Contact id.") },
    },
    async ({ id }) => run(() => deleteContact(db, id)),
  );

  /* ------------------------------------------------------------------- deals */

  server.registerTool(
    "deal_create",
    { title: "Create deal", description: "Create a pipeline deal (opportunity).", inputSchema: dealFields },
    async (args) => run(() => createDeal(db, args)),
  );

  server.registerTool(
    "deal_update",
    {
      title: "Update deal",
      description: "Update fields on an existing deal. Setting a closed stage also closes the deal.",
      inputSchema: { id: idField("Deal id."), ...optionalShape(dealFields) },
    },
    async ({ id, ...patch }) => run(() => updateDeal(db, id, patch)),
  );

  server.registerTool(
    "deal_get",
    {
      title: "Get deal",
      description: "Return one deal with its account, contact, recent activities, and open tasks.",
      inputSchema: { id: idField("Deal id.") },
    },
    async ({ id }) => run(() => getDeal(db, id)),
  );

  server.registerTool(
    "deal_search",
    {
      title: "Search deals",
      description: "Search deals by text, account, stage, status, owner, or minimum amount.",
      inputSchema: {
        query: z.string().optional().describe("Text matched against deal name and notes."),
        accountId: z.string().optional().describe("Restrict to one account."),
        stage: stageField.optional().describe("Exact stage filter."),
        status: z.enum(["open", "won", "lost"]).optional().describe("Exact status filter."),
        owner: z.string().optional().describe("Exact owner filter."),
        minAmount: z.number().min(0).optional().describe("Only deals worth at least this amount."),
        limit: limitField,
      },
    },
    async (args) => run(() => searchDeals(db, args)),
  );

  server.registerTool(
    "deal_advance_stage",
    {
      title: "Advance deal stage",
      description: "Move an open deal forward to the next stage, or to a named later stage.",
      inputSchema: {
        id: idField("Deal id."),
        toStage: z
          .enum(["lead", "qualified", "proposal", "negotiation"])
          .optional()
          .describe("Target stage. Must be later than the current stage. Defaults to the next stage."),
      },
    },
    async ({ id, toStage }) => run(() => advanceDealStage(db, id, toStage)),
  );

  server.registerTool(
    "deal_close",
    {
      title: "Close deal",
      description: "Close an open deal as won or lost and record the reason.",
      inputSchema: {
        id: idField("Deal id."),
        outcome: z.enum(["won", "lost"]).describe("Close outcome."),
        reason: z.string().optional().describe("Why the deal was won or lost. Appended to deal notes."),
      },
    },
    async ({ id, outcome, reason }) => run(() => closeDeal(db, id, outcome, reason)),
  );

  server.registerTool(
    "deal_delete",
    {
      title: "Delete deal",
      description: "Delete a deal and cascade to its activities and tasks.",
      inputSchema: { id: idField("Deal id.") },
    },
    async ({ id }) => run(() => deleteDeal(db, id)),
  );

  /* -------------------------------------------------------------- activities */

  server.registerTool(
    "activity_log",
    {
      title: "Log activity",
      description: "Log a call, email, meeting, or note against an account, contact, or deal.",
      inputSchema: {
        type: z.enum(ACTIVITY_TYPES).describe("Activity type."),
        subject: z.string().min(1).describe("Short summary line."),
        body: z.string().optional().describe("Full activity detail."),
        accountId: z.string().optional().describe("Related account id."),
        contactId: z.string().optional().describe("Related contact id."),
        dealId: z.string().optional().describe("Related deal id."),
        owner: z.string().optional().describe("Who performed the activity."),
        occurredAt: z.string().optional().describe("ISO timestamp. Defaults to now."),
      },
    },
    async (args) => run(() => logActivity(db, args)),
  );

  server.registerTool(
    "activity_list",
    {
      title: "List activities",
      description: "List activities newest first, filtered by text, type, related record, or date.",
      inputSchema: {
        query: z.string().optional().describe("Text matched against subject and body."),
        type: z.enum(ACTIVITY_TYPES).optional().describe("Exact type filter."),
        accountId: z.string().optional().describe("Restrict to one account."),
        contactId: z.string().optional().describe("Restrict to one contact."),
        dealId: z.string().optional().describe("Restrict to one deal."),
        since: z.string().optional().describe("Only activities at or after this ISO timestamp."),
        limit: limitField,
      },
    },
    async (args) => run(() => listActivities(db, args)),
  );

  /* ------------------------------------------------------------------- tasks */

  server.registerTool(
    "task_create",
    {
      title: "Create task",
      description: "Create a follow-up task, optionally linked to an account, contact, or deal.",
      inputSchema: {
        title: z.string().min(1).describe("What must be done."),
        dueDate: z.string().optional().describe("Due date as YYYY-MM-DD."),
        priority: z.enum(TASK_PRIORITIES).optional().describe("Priority. Default normal."),
        assignee: z.string().optional().describe("Who owns the task."),
        notes: z.string().optional().describe("Free-form task notes."),
        accountId: z.string().optional().describe("Related account id."),
        contactId: z.string().optional().describe("Related contact id."),
        dealId: z.string().optional().describe("Related deal id."),
      },
    },
    async (args) => run(() => createTask(db, args)),
  );

  server.registerTool(
    "task_complete",
    {
      title: "Complete task",
      description: "Mark an open task done and record the outcome.",
      inputSchema: {
        id: idField("Task id."),
        outcomeNote: z.string().optional().describe("What happened. Appended to task notes."),
      },
    },
    async ({ id, outcomeNote }) => run(() => completeTask(db, id, outcomeNote)),
  );

  server.registerTool(
    "task_list",
    {
      title: "List tasks",
      description: "List tasks by due date, filtered by status, assignee, account, deal, or due date.",
      inputSchema: {
        status: z.enum(["open", "done"]).optional().describe("Exact status filter."),
        assignee: z.string().optional().describe("Exact assignee filter."),
        accountId: z.string().optional().describe("Restrict to one account."),
        dealId: z.string().optional().describe("Restrict to one deal."),
        dueBefore: z.string().optional().describe("Only tasks due on or before this YYYY-MM-DD date."),
        limit: limitField,
      },
    },
    async (args) => run(() => listTasks(db, args)),
  );

  server.registerTool(
    "task_delete",
    { title: "Delete task", description: "Delete a task.", inputSchema: { id: idField("Task id.") } },
    async ({ id }) => run(() => deleteTask(db, id)),
  );

  /* ----------------------------------------------------------------- reports */

  server.registerTool(
    "report_pipeline",
    {
      title: "Pipeline report",
      description: "Summarize open pipeline by stage with raw and probability-weighted value, plus the top five deals.",
      inputSchema: {
        owner: z.string().optional().describe("Restrict to one owner."),
        accountId: z.string().optional().describe("Restrict to one account."),
      },
    },
    async (args) => run(() => pipelineReport(db, args)),
  );

  server.registerTool(
    "report_stats",
    {
      title: "CRM stats",
      description: "Return record counts, won and lost value, win rate, and open, done, and overdue task counts.",
      inputSchema: {
        asOf: z.string().optional().describe("ISO timestamp used to judge overdue tasks. Defaults to now."),
      },
    },
    async ({ asOf }) => run(() => crmStats(db, asOf)),
  );

  /* -------------------------------------------------------------------- demo */

  server.registerTool(
    "demo_seed",
    {
      title: "Seed demo data",
      description: "Load a realistic demo dataset of accounts, contacts, deals, activities, and tasks.",
      inputSchema: {
        reset: z.boolean().optional().describe("Clear existing data first. Default true."),
      },
    },
    async ({ reset }) => run(() => seedDemoData(db, reset ?? true)),
  );

  server.registerTool(
    "demo_reset",
    {
      title: "Reset database",
      description: "Delete every CRM record and leave an empty database.",
      inputSchema: {},
    },
    async () =>
      run(() => {
        resetDb(db);
        return { reset: true, stats: crmStats(db) };
      }),
  );
}
