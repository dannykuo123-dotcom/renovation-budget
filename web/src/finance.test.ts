import { describe, expect, it } from "vitest";
import { buildCashbookLedger, calculateBudgetItemSubtotal, calculateTotals, sortCashbookActivities } from "./finance";
import type { BudgetSpace, FundTransfer, LedgerEntry } from "./types";

const spaces: BudgetSpace[] = [{ id: "s1", name: "全屋", sortOrder: 1, items: [{ id: "b1", spaceId: "s1", categoryId: "c1", name: "工程預算", quantity: 1, unitPrice: 100000, plannedAmount: 100000, sortOrder: 1 }] }];
const entry = (kind: LedgerEntry["kind"], amount: number, status: LedgerEntry["status"] = "posted"): LedgerEntry => ({
  id: crypto.randomUUID(), kind, amount, status, description: "x", occurredOn: "2026-07-01", categoryId: "c1", personId: null,
  counterparty: "", paymentMethod: "轉帳", note: "", attachments: [], createdAt: "", updatedAt: "",
});

describe("calculateBudgetItemSubtotal", () => {
  it("rejects unsafe or implausibly large subtotals", () => {
    expect(calculateBudgetItemSubtotal(Number.MAX_SAFE_INTEGER, 2)).toBeNull();
    expect(calculateBudgetItemSubtotal(1, 1_000_000_000_001)).toBeNull();
  });

  it("returns quantity times unit price for a valid budget item", () => {
    expect(calculateBudgetItemSubtotal(3, 2500)).toBe(7500);
  });
});

describe("calculateTotals", () => {
  it("separates incoming funds and paid expenses", () => {
    const totals = calculateTotals(spaces, [entry("income", 150000), entry("expense", 50000)]);
    expect(totals).toEqual({ planned: 100000, received: 150000, spent: 50000, pending: 0, cashBalance: 100000, budgetRemaining: 50000 });
  });

  it("adds planned budget from the items inside each space", () => {
    const spaces: BudgetSpace[] = [
      {
        id: "living-room",
        name: "客廳",
        sortOrder: 1,
        items: [
          { id: "lamp", spaceId: "living-room", categoryId: "c1", name: "淘寶吊燈", quantity: 2, unitPrice: 3200, plannedAmount: 6400, sortOrder: 1 },
          { id: "screen", spaceId: "living-room", categoryId: "c1", name: "紗窗", quantity: 1, unitPrice: 10000, plannedAmount: 10000, sortOrder: 2 },
        ],
      },
    ];

    const totals = calculateTotals(spaces, [entry("expense", 800)]);

    expect(totals.planned).toBe(16400);
    expect(totals.budgetRemaining).toBe(15600);
  });

  it("derives each item subtotal from quantity and unit price", () => {
    const spaces: BudgetSpace[] = [
      {
        id: "kitchen",
        name: "廚房",
        sortOrder: 1,
        items: [
          { id: "tile", spaceId: "kitchen", categoryId: null, name: "壁磚", quantity: 3, unitPrice: 2500, plannedAmount: 1, sortOrder: 1 },
        ],
      },
    ];

    const totals = calculateTotals(spaces, []);

    expect(totals.planned).toBe(7500);
    expect(totals.budgetRemaining).toBe(7500);
  });
});

describe("buildCashbookLedger", () => {
  const transfer = (
    id: string,
    fromPersonId: string,
    toPersonId: string,
    amount: number,
    status: FundTransfer["status"] = "posted",
    occurredOn = "2026-07-02",
  ): FundTransfer => ({
    id,
    fromPersonId,
    toPersonId,
    amount,
    occurredOn,
    status,
    paymentMethod: "轉帳",
    note: "",
    createdAt: `${occurredOn}T08:00:00Z`,
    updatedAt: "",
  });

  it("builds the project ledger without changing the balance for internal transfers", () => {
    const ledger = buildCashbookLedger([
      { ...entry("income", 400000), id: "income", personId: "ming", createdAt: "2026-07-01T08:00:00Z" },
      { ...entry("expense", 14719), id: "expense", personId: "danny", occurredOn: "2026-07-03", createdAt: "2026-07-03T08:00:00Z" },
    ], [transfer("transfer", "ming", "danny", 100000)], null);

    expect(ledger).toMatchObject({ deposited: 400000, withdrawn: 14719, balance: 385281 });
    expect(ledger.activities.map((activity) => ({
      id: activity.id,
      delta: activity.delta,
      runningBalance: activity.runningBalance,
    }))).toEqual([
      { id: "expense", delta: -14719, runningBalance: 385281 },
      { id: "transfer", delta: 0, runningBalance: 400000 },
      { id: "income", delta: 400000, runningBalance: 400000 },
    ]);
  });

  it("builds a personal passbook from entries and both transfer directions", () => {
    const ledger = buildCashbookLedger([
      { ...entry("expense", 14719), id: "expense", personId: "danny", occurredOn: "2026-07-04", createdAt: "2026-07-04T08:00:00Z" },
    ], [
      transfer("transfer-in", "ming", "danny", 100000, "posted", "2026-07-02"),
      transfer("transfer-out", "danny", "mike", 100000, "posted", "2026-07-03"),
    ], "danny");

    expect(ledger).toMatchObject({ deposited: 100000, withdrawn: 114719, balance: -14719 });
    expect(ledger.activities.map((activity) => activity.kind)).toEqual(["expense", "transfer-out", "transfer-in"]);
    expect(ledger.activities.map((activity) => activity.runningBalance)).toEqual([-14719, 0, 100000]);
  });

  it("keeps pending activity visible without changing totals and removes void activity", () => {
    const ledger = buildCashbookLedger([], [
      transfer("posted", "ming", "mike", 1000),
      transfer("pending", "ming", "mike", 200, "pending", "2026-07-03"),
      transfer("void", "ming", "mike", 300, "void", "2026-07-04"),
    ], "mike");

    expect(ledger).toMatchObject({ deposited: 1000, withdrawn: 0, balance: 1000 });
    expect(ledger.activities.map((activity) => ({
      id: activity.id,
      status: activity.status,
      runningBalance: activity.runningBalance,
    }))).toEqual([
      { id: "pending", status: "pending", runningBalance: null },
      { id: "posted", status: "posted", runningBalance: 1000 },
    ]);
  });

  it("uses creation time to keep same-day balances stable", () => {
    const ledger = buildCashbookLedger([
      { ...entry("income", 100), id: "early", createdAt: "2026-07-01T08:00:00Z" },
      { ...entry("expense", 10), id: "late", createdAt: "2026-07-01T09:00:00Z" },
    ], [], null);

    expect(ledger.activities.map((activity) => ({
      id: activity.id,
      runningBalance: activity.runningBalance,
    }))).toEqual([
      { id: "late", runningBalance: 90 },
      { id: "early", runningBalance: 100 },
    ]);

    expect(sortCashbookActivities(ledger.activities, "asc").map((activity) => ({
      id: activity.id,
      runningBalance: activity.runningBalance,
    }))).toEqual([
      { id: "early", runningBalance: 100 },
      { id: "late", runningBalance: 90 },
    ]);
  });
});
