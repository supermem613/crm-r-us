import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { MEMORY_DB, openDb } from "../../src/crm/db.js";
import { seedDemoData } from "../../src/crm/seed.js";
import { crmStats, listTasks, pipelineReport, searchAccounts, searchDeals } from "../../src/crm/store.js";

describe("demo seed", () => {
  it("loads a dataset with open pipeline, closed deals, and follow-up tasks", () => {
    const db = openDb(MEMORY_DB);

    const summary = seedDemoData(db);

    assert.equal(summary.accounts, 8);
    assert.equal(summary.contacts, 18);
    assert.equal(summary.deals, 12);
    assert.ok(summary.activities > summary.deals);
    assert.ok(summary.tasks > 0);

    const stats = crmStats(db);
    assert.equal(stats.accounts, 8);
    assert.equal(stats.deals.won, 2);
    assert.equal(stats.deals.lost, 1);
    assert.equal(stats.deals.open, 9);
    assert.ok(stats.tasks.overdue > 0, "seed includes overdue follow-ups so demos show them");

    const report = pipelineReport(db);
    assert.equal(report.openDealCount, 9);
    assert.ok(report.openValue > report.weightedValue);

    assert.equal(searchAccounts(db, { query: "Contoso" }).length, 1);
    assert.equal(searchDeals(db, { owner: "dana", status: "open" }).length, 4);
    assert.ok(listTasks(db, { status: "open" }).length > 0);
  });

  it("replaces prior data when reseeded", () => {
    const db = openDb(MEMORY_DB);

    seedDemoData(db);
    seedDemoData(db);

    assert.equal(crmStats(db).accounts, 8);
  });
});
