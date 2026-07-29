import { describe, expect, it } from "vitest";
import { calculatePersonBalances, calculatePersonCashbookSummaries, calculateTotals } from "./finance";
import type { Category, FundTransfer, LedgerEntry, Person } from "./types";

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

describe("calculatePersonBalances", () => {
  const person = (id: string, name: string): Person => ({
    id, name, role: "", note: "", active: true, createdAt: "", updatedAt: "",
  });
  const people = [person("ming", "Ming"), person("danny", "Danny"), person("mike", "Mike")];

  it("tracks how much project money each person currently holds", () => {
    const entries: LedgerEntry[] = [
      { ...entry("income", 400000), personId: "ming" },
      { ...entry("expense", 47364), personId: "danny" },
      { ...entry("expense", 8600), personId: "mike" },
    ];
    const transfers: FundTransfer[] = [
      { id: "t1", fromPersonId: "ming", toPersonId: "danny", amount: 100000, occurredOn: "2026-07-02", status: "posted", paymentMethod: "", note: "", createdAt: "", updatedAt: "" },
      { id: "t2", fromPersonId: "danny", toPersonId: "mike", amount: 100000, occurredOn: "2026-07-03", status: "posted", paymentMethod: "", note: "", createdAt: "", updatedAt: "" },
    ];
    const balances = calculatePersonBalances(people, entries, transfers);
    expect(balances.find((item) => item.person.id === "ming")?.balance).toBe(300000);
    expect(balances.find((item) => item.person.id === "danny")?.balance).toBe(-47364);
    expect(balances.find((item) => item.person.id === "mike")?.balance).toBe(91400);
    expect(balances.reduce((sum, item) => sum + item.balance, 0)).toBe(344036);
  });

  it("ignores pending and void activity until it is completed", () => {
    const entries: LedgerEntry[] = [
      { ...entry("income", 1000), personId: "ming" },
      { ...entry("expense", 80, "pending"), personId: "ming" },
    ];
    const transfers: FundTransfer[] = [
      { id: "t1", fromPersonId: "ming", toPersonId: "danny", amount: 200, occurredOn: "2026-07-02", status: "pending", paymentMethod: "", note: "", createdAt: "", updatedAt: "" },
      { id: "t2", fromPersonId: "ming", toPersonId: "mike", amount: 99, occurredOn: "2026-07-03", status: "void", paymentMethod: "", note: "", createdAt: "", updatedAt: "" },
    ];
    const balances = calculatePersonBalances(people, entries, transfers);
    expect(balances.find((item) => item.person.id === "ming")?.balance).toBe(1000);
    expect(balances.find((item) => item.person.id === "danny")?.balance).toBe(0);
    expect(balances.find((item) => item.person.id === "mike")?.balance).toBe(0);
  });
});

describe("calculatePersonCashbookSummaries", () => {
  it("shows a person's expense under paid, not received", () => {
    const mike: Person = { id: "mike", name: "Mike", role: "水電工", note: "", active: true, createdAt: "", updatedAt: "" };
    const summary = calculatePersonCashbookSummaries([mike], [
      { ...entry("expense", 8600), personId: "mike" },
      { ...entry("income", 12000), personId: "mike" },
    ], []).at(0)!;

    expect(summary.income).toBe(12000);
    expect(summary.paid).toBe(8600);
    expect(summary.cashOnHand).toBe(3400);
  });
});
