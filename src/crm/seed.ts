import { resetDb, type Db } from "./db.js";
import {
  createAccount,
  createContact,
  createDeal,
  createTask,
  logActivity,
  closeDeal,
  type DealStage,
} from "./store.js";

function dayOffset(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function timeOffset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export interface SeedSummary {
  accounts: number;
  contacts: number;
  deals: number;
  activities: number;
  tasks: number;
  reset: boolean;
}

interface SeedAccount {
  name: string;
  industry: string;
  website: string;
  owner: string;
  contacts: { firstName: string; lastName: string; title: string }[];
  deals: { name: string; amount: number; stage: DealStage; closeIn: number }[];
}

const DEMO: SeedAccount[] = [
  {
    name: "Northwind Traders",
    industry: "Retail",
    website: "https://northwind.example",
    owner: "dana",
    contacts: [
      { firstName: "Ava", lastName: "Bennett", title: "VP Operations" },
      { firstName: "Liam", lastName: "Ortega", title: "IT Director" },
    ],
    deals: [
      { name: "Northwind store rollout", amount: 180000, stage: "negotiation", closeIn: 21 },
      { name: "Northwind support renewal", amount: 42000, stage: "qualified", closeIn: 60 },
    ],
  },
  {
    name: "Contoso Manufacturing",
    industry: "Manufacturing",
    website: "https://contoso.example",
    owner: "sam",
    contacts: [
      { firstName: "Priya", lastName: "Raman", title: "Plant Manager" },
      { firstName: "Owen", lastName: "Fischer", title: "CFO" },
      { firstName: "Mei", lastName: "Chen", title: "Procurement Lead" },
    ],
    deals: [
      { name: "Contoso line telemetry", amount: 260000, stage: "proposal", closeIn: 35 },
    ],
  },
  {
    name: "Fabrikam Health",
    industry: "Healthcare",
    website: "https://fabrikam.example",
    owner: "dana",
    contacts: [
      { firstName: "Noah", lastName: "Klein", title: "CIO" },
      { firstName: "Sofia", lastName: "Duarte", title: "Compliance Officer" },
    ],
    deals: [
      { name: "Fabrikam records migration", amount: 320000, stage: "qualified", closeIn: 75 },
      { name: "Fabrikam pilot program", amount: 55000, stage: "closed-won", closeIn: -10 },
    ],
  },
  {
    name: "Tailspin Logistics",
    industry: "Transportation",
    website: "https://tailspin.example",
    owner: "sam",
    contacts: [
      { firstName: "Marco", lastName: "Silva", title: "Fleet Director" },
      { firstName: "Hana", lastName: "Sato", title: "Operations Analyst" },
    ],
    deals: [
      { name: "Tailspin route optimizer", amount: 145000, stage: "lead", closeIn: 90 },
    ],
  },
  {
    name: "Adventure Works",
    industry: "Sporting Goods",
    website: "https://adventureworks.example",
    owner: "kai",
    contacts: [
      { firstName: "Ellie", lastName: "Novak", title: "Head of Ecommerce" },
      { firstName: "Ben", lastName: "Adeyemi", title: "Marketing Manager" },
    ],
    deals: [
      { name: "Adventure Works storefront", amount: 98000, stage: "proposal", closeIn: 28 },
      { name: "Adventure Works loyalty add-on", amount: 24000, stage: "closed-lost", closeIn: -5 },
    ],
  },
  {
    name: "Litware Financial",
    industry: "Financial Services",
    website: "https://litware.example",
    owner: "kai",
    contacts: [
      { firstName: "Grace", lastName: "Whitfield", title: "Risk Director" },
      { firstName: "Tomas", lastName: "Vidal", title: "Head of Data" },
    ],
    deals: [
      { name: "Litware risk reporting", amount: 410000, stage: "negotiation", closeIn: 14 },
    ],
  },
  {
    name: "Proseware Media",
    industry: "Media",
    website: "https://proseware.example",
    owner: "dana",
    contacts: [
      { firstName: "Ines", lastName: "Moreau", title: "Product Lead" },
      { firstName: "Caleb", lastName: "Ross", title: "Engineering Manager" },
    ],
    deals: [
      { name: "Proseware audience platform", amount: 76000, stage: "lead", closeIn: 120 },
    ],
  },
  {
    name: "Wingtip Toys",
    industry: "Consumer Goods",
    website: "https://wingtip.example",
    owner: "sam",
    contacts: [
      { firstName: "Rosa", lastName: "Iyer", title: "Supply Chain Lead" },
      { firstName: "Dmitri", lastName: "Petrov", title: "COO" },
      { firstName: "Nina", lastName: "Alvarez", title: "Buyer" },
    ],
    deals: [
      { name: "Wingtip demand forecasting", amount: 132000, stage: "qualified", closeIn: 45 },
      { name: "Wingtip warehouse refresh", amount: 67000, stage: "closed-won", closeIn: -20 },
    ],
  },
];

export function seedDemoData(db: Db, reset = true): SeedSummary {
  if (reset) {
    resetDb(db);
  }

  const summary: SeedSummary = { accounts: 0, contacts: 0, deals: 0, activities: 0, tasks: 0, reset };
  let dealIndex = 0;

  for (const spec of DEMO) {
    const account = createAccount(db, {
      name: spec.name,
      industry: spec.industry,
      website: spec.website,
      owner: spec.owner,
      phone: "+1-555-0100",
      notes: `Demo account for ${spec.industry.toLowerCase()} scenarios.`,
    });
    summary.accounts += 1;

    const contacts = spec.contacts.map((person) => {
      summary.contacts += 1;
      return createContact(db, {
        accountId: account.id,
        firstName: person.firstName,
        lastName: person.lastName,
        title: person.title,
        email: `${person.firstName.toLowerCase()}.${person.lastName.toLowerCase()}@${new URL(spec.website).hostname}`,
        phone: "+1-555-0142",
      });
    });

    for (const dealSpec of spec.deals) {
      dealIndex += 1;
      const primaryContact = contacts[dealIndex % contacts.length];
      const isClosed = dealSpec.stage === "closed-won" || dealSpec.stage === "closed-lost";
      const deal = createDeal(db, {
        name: dealSpec.name,
        accountId: account.id,
        contactId: primaryContact.id,
        amount: dealSpec.amount,
        stage: isClosed ? "negotiation" : dealSpec.stage,
        owner: spec.owner,
        expectedCloseDate: dayOffset(dealSpec.closeIn),
        notes: `Seeded demo deal for ${spec.name}.`,
      });
      summary.deals += 1;

      if (isClosed) {
        closeDeal(
          db,
          deal.id,
          dealSpec.stage === "closed-won" ? "won" : "lost",
          dealSpec.stage === "closed-won" ? "Signed after pilot review." : "Lost on price to incumbent.",
        );
      }

      logActivity(db, {
        type: dealIndex % 2 === 0 ? "call" : "meeting",
        subject: `Discovery on ${dealSpec.name}`,
        body: "Reviewed requirements, timeline, and budget owner.",
        accountId: account.id,
        contactId: primaryContact.id,
        dealId: deal.id,
        owner: spec.owner,
        occurredAt: timeOffset(-(dealIndex + 2)),
      });
      summary.activities += 1;

      if (!isClosed) {
        createTask(db, {
          title: `Send follow-up recap for ${dealSpec.name}`,
          dueDate: dayOffset(dealIndex % 3 === 0 ? -2 : 5),
          priority: dealSpec.amount > 150000 ? "high" : "normal",
          assignee: spec.owner,
          accountId: account.id,
          contactId: primaryContact.id,
          dealId: deal.id,
        });
        summary.tasks += 1;
      }
    }

    logActivity(db, {
      type: "email",
      subject: `Quarterly check-in with ${spec.name}`,
      body: "Shared roadmap update and asked for expansion opportunities.",
      accountId: account.id,
      contactId: contacts[0].id,
      owner: spec.owner,
      occurredAt: timeOffset(-1),
    });
    summary.activities += 1;
  }

  return summary;
}
