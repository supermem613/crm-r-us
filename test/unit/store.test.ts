import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { MEMORY_DB, openDb } from "../../src/crm/db.js";
import {
  CrmError,
  advanceDealStage,
  closeDeal,
  completeTask,
  createAccount,
  createContact,
  createDeal,
  createTask,
  crmStats,
  deleteAccount,
  getAccount,
  getDeal,
  listActivities,
  listTasks,
  logActivity,
  pipelineReport,
  searchAccounts,
  searchContacts,
  searchDeals,
  updateAccount,
} from "../../src/crm/store.js";

function fixture() {
  const db = openDb(MEMORY_DB);
  const account = createAccount(db, { name: "Contoso Manufacturing", industry: "Manufacturing", owner: "sam" });
  const contact = createContact(db, {
    accountId: account.id,
    firstName: "Priya",
    lastName: "Raman",
    email: "priya@contoso.example",
  });
  return { db, account, contact };
}

describe("crm accounts and contacts", () => {
  it("creates, reads, updates, and searches an account", () => {
    const { db, account } = fixture();

    assert.match(account.id, /^acc_[0-9a-f]{10}$/);
    assert.equal(account.name, "Contoso Manufacturing");

    const updated = updateAccount(db, account.id, { owner: "dana" });
    assert.equal(updated.owner, "dana");
    assert.equal(updated.industry, "Manufacturing", "unsupplied fields stay unchanged");

    const detail = getAccount(db, account.id);
    assert.equal(detail.contacts.length, 1);
    assert.equal(detail.openDeals.length, 0);

    assert.equal(searchAccounts(db, { query: "contoso" }).length, 1);
    assert.equal(searchAccounts(db, { owner: "dana" }).length, 1);
    assert.equal(searchAccounts(db, { owner: "nobody" }).length, 0);
  });

  it("reports a not_found error for a missing id", () => {
    const { db } = fixture();
    assert.throws(
      () => getAccount(db, "acc_missing"),
      (err: unknown) => err instanceof CrmError && err.code === "not_found",
    );
  });

  it("finds contacts by account and by text", () => {
    const { db, account } = fixture();
    assert.equal(searchContacts(db, { accountId: account.id }).length, 1);
    assert.equal(searchContacts(db, { query: "priya" }).length, 1);
  });

  it("cascades deletes from an account to its children", () => {
    const { db, account, contact } = fixture();
    const deal = createDeal(db, { name: "Line telemetry", accountId: account.id, amount: 1000 });
    logActivity(db, { type: "call", subject: "Intro call", accountId: account.id, contactId: contact.id });
    createTask(db, { title: "Send recap", accountId: account.id, dealId: deal.id });

    const result = deleteAccount(db, account.id);

    assert.deepEqual(result.cascaded, { contacts: 1, deals: 1, activities: 1, tasks: 1 });
    assert.equal(searchContacts(db, {}).length, 0);
    assert.equal(searchDeals(db, {}).length, 0);
    assert.equal(listActivities(db, {}).length, 0);
    assert.equal(listTasks(db, {}).length, 0);
  });
});

describe("crm deals", () => {
  it("advances stages in order and sets the stage probability", () => {
    const { db, account } = fixture();
    const deal = createDeal(db, { name: "Line telemetry", accountId: account.id, amount: 260000 });

    assert.equal(deal.stage, "lead");
    assert.equal(deal.probability, 10);
    assert.equal(deal.status, "open");

    assert.equal(advanceDealStage(db, deal.id).stage, "qualified");
    const jumped = advanceDealStage(db, deal.id, "negotiation");
    assert.equal(jumped.stage, "negotiation");
    assert.equal(jumped.probability, 75);
  });

  it("refuses to advance backwards or past the last open stage", () => {
    const { db, account } = fixture();
    const deal = createDeal(db, { name: "Backwards", accountId: account.id, stage: "proposal" });

    assert.throws(
      () => advanceDealStage(db, deal.id, "qualified"),
      (err: unknown) => err instanceof CrmError && err.code === "stage_not_forward",
    );

    advanceDealStage(db, deal.id);
    assert.throws(
      () => advanceDealStage(db, deal.id),
      (err: unknown) => err instanceof CrmError && err.code === "stage_final",
    );
  });

  it("closes a deal as won and records the reason", () => {
    const { db, account } = fixture();
    const deal = createDeal(db, { name: "Pilot", accountId: account.id, amount: 55000 });

    const closed = closeDeal(db, deal.id, "won", "Signed after pilot review.");

    assert.equal(closed.status, "won");
    assert.equal(closed.stage, "closed-won");
    assert.equal(closed.probability, 100);
    assert.ok(closed.closedAt);
    assert.match(closed.notes ?? "", /Signed after pilot review\./);

    assert.throws(
      () => closeDeal(db, deal.id, "lost"),
      (err: unknown) => err instanceof CrmError && err.code === "deal_closed",
    );
  });

  it("returns related records with a deal", () => {
    const { db, account, contact } = fixture();
    const deal = createDeal(db, { name: "Rollout", accountId: account.id, contactId: contact.id, amount: 180000 });
    logActivity(db, { type: "meeting", subject: "Scoping", dealId: deal.id });
    createTask(db, { title: "Draft SOW", dealId: deal.id });

    const detail = getDeal(db, deal.id);

    assert.equal(detail.account?.id, account.id);
    assert.equal(detail.contact?.id, contact.id);
    assert.equal(detail.recentActivities.length, 1);
    assert.equal(detail.openTasks.length, 1);
  });
});

describe("crm activities and tasks", () => {
  it("rejects an activity that references nothing", () => {
    const { db } = fixture();
    assert.throws(
      () => logActivity(db, { type: "note", subject: "Floating note" }),
      (err: unknown) => err instanceof CrmError && err.code === "unlinked_activity",
    );
  });

  it("filters activities by type and related record", () => {
    const { db, account, contact } = fixture();
    logActivity(db, { type: "call", subject: "Intro call", accountId: account.id });
    logActivity(db, { type: "email", subject: "Follow-up", contactId: contact.id });

    assert.equal(listActivities(db, { type: "call" }).length, 1);
    assert.equal(listActivities(db, { contactId: contact.id }).length, 1);
    assert.equal(listActivities(db, {}).length, 2);
  });

  it("completes a task once and appends the outcome", () => {
    const { db, account } = fixture();
    const task = createTask(db, { title: "Send recap", accountId: account.id, dueDate: "2020-01-01" });

    const done = completeTask(db, task.id, "Recap sent.");

    assert.equal(done.status, "done");
    assert.ok(done.completedAt);
    assert.match(done.notes ?? "", /Recap sent\./);

    assert.throws(
      () => completeTask(db, task.id),
      (err: unknown) => err instanceof CrmError && err.code === "task_done",
    );
  });

  it("counts overdue open tasks as of a timestamp", () => {
    const { db, account } = fixture();
    createTask(db, { title: "Overdue", accountId: account.id, dueDate: "2020-01-01" });
    createTask(db, { title: "Future", accountId: account.id, dueDate: "2999-01-01" });

    const stats = crmStats(db, "2021-01-01T00:00:00.000Z");

    assert.equal(stats.tasks.open, 2);
    assert.equal(stats.tasks.overdue, 1);
  });
});

describe("crm reports", () => {
  it("summarizes open pipeline by stage with weighted value", () => {
    const { db, account } = fixture();
    createDeal(db, { name: "A", accountId: account.id, amount: 100000, stage: "qualified" });
    createDeal(db, { name: "B", accountId: account.id, amount: 200000, stage: "negotiation" });
    const closed = createDeal(db, { name: "C", accountId: account.id, amount: 50000 });
    closeDeal(db, closed.id, "won");

    const report = pipelineReport(db);

    assert.equal(report.openDealCount, 2);
    assert.equal(report.openValue, 300000);
    // 100000 * 0.25 + 200000 * 0.75
    assert.equal(report.weightedValue, 175000);
    assert.equal(report.stages.length, 4);
    assert.equal(report.topDeals[0].name, "B");
  });

  it("reports win rate over closed deals only", () => {
    const { db, account } = fixture();
    const won = createDeal(db, { name: "Won", accountId: account.id, amount: 60000 });
    const lost = createDeal(db, { name: "Lost", accountId: account.id, amount: 20000 });
    createDeal(db, { name: "Open", accountId: account.id, amount: 10000 });
    closeDeal(db, won.id, "won");
    closeDeal(db, lost.id, "lost");

    const stats = crmStats(db);

    assert.deepEqual(stats.deals, { open: 1, won: 1, lost: 1 });
    assert.equal(stats.wonValue, 60000);
    assert.equal(stats.lostValue, 20000);
    assert.equal(stats.winRate, 50);
  });
});
