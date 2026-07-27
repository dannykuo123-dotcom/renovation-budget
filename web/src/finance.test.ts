import { describe, expect, it } from "vitest";
import { calculatePersonCashflows, calculateTotals } from "./finance";
import type { Category, FundTransfer, LedgerEntry, Person } from "./types";

const categories: Category[] = [{ id: "c1", name: "材料", plannedAmount: 100000, color: "#6d5bd0", sortOrder: 1, items: [] }];
const entry = (kind: LedgerEntry["kind"], amount: number, status: LedgerEntry["status"] = "posted"): LedgerEntry => ({
  id: crypto.randomUUID(), kind, amount, status, refundOfEntryId: kind === "refund" ? "expense-1" : null, description: "x", occurredOn: "2026-07-01", categoryId: "c1", personId: null,
  counterparty: "", paymentMethod: "轉帳", note: "", attachments: [], createdAt: "", updatedAt: "",
});

describe("calculateTotals", () => {
  it("separates incoming funds, paid expenses, and refunds", () => {
    const totals = calculateTotals(categories, [entry("income", 150000), entry("expense", 50000), entry("refund", 3000)]);
    expect(totals).toEqual({ planned: 100000, received: 150000, spent: 47000, pending: 0, returned: 3000, pendingRefund: 0, cashBalance: 103000, budgetRemaining: 53000 });
  });

  it("returns a fully refunded expense to the available balance and budget", () => {
    const totals = calculateTotals(categories, [entry("income", 100000), entry("expense", 25000), entry("refund", 25000)]);
    expect(totals).toEqual({ planned: 100000, received: 100000, spent: 0, pending: 0, returned: 25000, pendingRefund: 0, cashBalance: 100000, budgetRemaining: 100000 });
  });

  it("does not return funds until a pending refund is completed", () => {
    const totals = calculateTotals(categories, [entry("income", 100000), entry("expense", 500), entry("refund", 500, "pending")]);
    expect(totals).toMatchObject({ spent: 500, returned: 0, pendingRefund: 500, cashBalance: 99500, budgetRemaining: 99500 });
  });

  it("supports partial completed refunds while tracking the remaining pending refund", () => {
    const totals = calculateTotals(categories, [entry("income", 100000), entry("expense", 500), entry("refund", 300), entry("refund", 200, "pending")]);
    expect(totals).toMatchObject({ spent: 200, returned: 300, pendingRefund: 200, cashBalance: 99800, budgetRemaining: 99800 });
  });
});

describe("calculatePersonCashflows", () => {
  const person = (id: string, name: string): Person => ({
    id, name, role: "", note: "", active: true, createdAt: "", updatedAt: "",
  });
  const people = [person("alice", "Alice"), person("bob", "Bob")];

  it("lists engineering expenses as paid while keeping direct transfer receipts separate", () => {
    const entries: LedgerEntry[] = [
      { ...entry("income", 1000), personId: "alice" },
      { ...entry("expense", 300), personId: "bob" },
      { ...entry("refund", 50), personId: "bob" },
    ];
    const transfers: FundTransfer[] = [
      { id: "t1", fromPersonId: "alice", toPersonId: "bob", amount: 200, occurredOn: "2026-07-02", status: "posted", paymentMethod: "", note: "", createdAt: "", updatedAt: "" },
      { id: "t2", fromPersonId: "bob", toPersonId: "alice", amount: 40, occurredOn: "2026-07-03", status: "pending", paymentMethod: "", note: "", createdAt: "", updatedAt: "" },
      { id: "t3", fromPersonId: "alice", toPersonId: "bob", amount: 99, occurredOn: "2026-07-04", status: "void", paymentMethod: "", note: "", createdAt: "", updatedAt: "" },
    ];
    const summaries = calculatePersonCashflows(people, entries, transfers);
    expect(summaries.find((item) => item.person.id === "alice")).toMatchObject({
      paid: 1200, received: 0, pendingReceive: 40, pendingPay: 0, net: -1000,
    });
    expect(summaries.find((item) => item.person.id === "bob")).toMatchObject({
      paid: 350, received: 200, pendingReceive: 0, pendingPay: 40, net: 250,
    });
  });
});
