import { describe, expect, it } from "vitest";
import { buildCashbookLedger, calculateTotals } from "./finance";
import type { Category, FundTransfer, LedgerEntry } from "./types";

const categories: Category[] = [{ id: "c1", name: "材料", plannedAmount: 100000, color: "#6d5bd0", sortOrder: 1, items: [] }];
const entry = (kind: LedgerEntry["kind"], amount: number, status: LedgerEntry["status"] = "posted"): LedgerEntry => ({
  id: crypto.randomUUID(), kind, amount, status, description: "x", occurredOn: "2026-07-01", categoryId: "c1", personId: null,
  counterparty: "", paymentMethod: "轉帳", note: "", attachments: [], createdAt: "", updatedAt: "",
});

describe("calculateTotals", () => {
  it("separates incoming funds and paid expenses", () => {
    const totals = calculateTotals(categories, [entry("income", 150000), entry("expense", 50000)]);
    expect(totals).toEqual({ planned: 100000, received: 150000, spent: 50000, pending: 0, cashBalance: 100000, budgetRemaining: 50000 });
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
  });
});
