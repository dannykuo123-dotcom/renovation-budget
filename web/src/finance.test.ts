import { describe, expect, it } from "vitest";
import { calculateTotals } from "./finance";
import type { Category, LedgerEntry } from "./types";

const categories: Category[] = [{ id: "c1", name: "材料", plannedAmount: 100000, color: "#6d5bd0", sortOrder: 1 }];
const entry = (kind: LedgerEntry["kind"], amount: number, status: LedgerEntry["status"] = "posted"): LedgerEntry => ({
  id: crypto.randomUUID(), kind, amount, status, description: "x", occurredOn: "2026-07-01", categoryId: "c1",
  counterparty: "", paymentMethod: "轉帳", note: "", attachments: [], createdAt: "", updatedAt: "",
});

describe("calculateTotals", () => {
  it("separates incoming funds, paid expense, pending expense, and refunds", () => {
    const totals = calculateTotals(categories, [entry("income", 150000), entry("expense", 40000), entry("expense", 10000, "pending"), entry("refund", 3000)]);
    expect(totals).toEqual({ planned: 100000, received: 150000, spent: 37000, pending: 10000, cashBalance: 113000, budgetRemaining: 63000 });
  });

  it("returns a fully refunded expense to the available balance and budget", () => {
    const totals = calculateTotals(categories, [entry("income", 100000), entry("expense", 25000, "refunded")]);
    expect(totals).toEqual({ planned: 100000, received: 100000, spent: 0, pending: 0, cashBalance: 100000, budgetRemaining: 100000 });
  });
});
