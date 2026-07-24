import type { Category, LedgerEntry } from "./types";

export interface Totals {
  planned: number;
  received: number;
  spent: number;
  pending: number;
  cashBalance: number;
  budgetRemaining: number;
}

export function calculateTotals(categories: Category[], entries: LedgerEntry[]): Totals {
  const planned = categories.reduce((sum, category) => sum + category.plannedAmount, 0);
  let received = 0;
  let spent = 0;
  let pending = 0;

  for (const entry of entries) {
    if (entry.status === "void") continue;
    if (entry.kind === "income" && entry.status === "posted") received += entry.amount;
    if (entry.kind === "expense") {
      if (entry.status === "posted") spent += entry.amount;
      if (entry.status === "pending") pending += entry.amount;
    }
    if (entry.kind === "refund" && entry.status === "posted") spent -= entry.amount;
  }

  return {
    planned,
    received,
    spent,
    pending,
    cashBalance: received - spent,
    budgetRemaining: planned - spent,
  };
}

export function categorySpent(categoryId: string, entries: LedgerEntry[]): number {
  return entries.reduce((sum, entry) => {
    if (entry.categoryId !== categoryId || entry.status !== "posted") return sum;
    if (entry.kind === "expense") return sum + entry.amount;
    if (entry.kind === "refund") return sum - entry.amount;
    return sum;
  }, 0);
}

export const formatMoney = (amount: number) =>
  new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(amount);
