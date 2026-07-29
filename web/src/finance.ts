import type { Category, FundTransfer, LedgerEntry } from "./types";

export interface Totals {
  planned: number;
  received: number;
  spent: number;
  pending: number;
  cashBalance: number;
  budgetRemaining: number;
}

export type CashbookActivityKind = "income" | "expense" | "transfer" | "transfer-in" | "transfer-out";
export type CashbookActivityStatus = LedgerEntry["status"] | FundTransfer["status"];

export interface CashbookActivity {
  id: string;
  source: "entry" | "transfer";
  kind: CashbookActivityKind;
  status: CashbookActivityStatus;
  occurredOn: string;
  createdAt: string;
  description: string;
  paymentMethod: string;
  note: string;
  personId: string | null;
  fromPersonId: string | null;
  toPersonId: string | null;
  amount: number;
  delta: number;
  runningBalance: number | null;
}

export interface CashbookLedger {
  deposited: number;
  withdrawn: number;
  balance: number;
  activities: CashbookActivity[];
}

export function sortCashbookActivities(
  activities: CashbookActivity[],
  direction: "asc" | "desc",
): CashbookActivity[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...activities].sort((left, right) => multiplier * (
    left.occurredOn.localeCompare(right.occurredOn) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  ));
}

export function buildCashbookLedger(
  entries: LedgerEntry[],
  transfers: FundTransfer[],
  personId: string | null,
): CashbookLedger {
  const activities: CashbookActivity[] = [];

  for (const entry of entries) {
    if (entry.status === "void" || (personId && entry.personId !== personId)) continue;
    const delta = entry.kind === "income" ? entry.amount : -entry.amount;
    activities.push({
      id: entry.id,
      source: "entry",
      kind: entry.kind,
      status: entry.status,
      occurredOn: entry.occurredOn,
      createdAt: entry.createdAt,
      description: entry.description,
      paymentMethod: entry.paymentMethod,
      note: entry.note,
      personId: entry.personId,
      fromPersonId: null,
      toPersonId: null,
      amount: entry.amount,
      delta,
      runningBalance: null,
    });
  }

  for (const transfer of transfers) {
    if (transfer.status === "void") continue;
    let kind: CashbookActivityKind = "transfer";
    let delta = 0;
    if (personId) {
      if (transfer.fromPersonId === personId) {
        kind = "transfer-out";
        delta = -transfer.amount;
      } else if (transfer.toPersonId === personId) {
        kind = "transfer-in";
        delta = transfer.amount;
      } else {
        continue;
      }
    }
    activities.push({
      id: transfer.id,
      source: "transfer",
      kind,
      status: transfer.status,
      occurredOn: transfer.occurredOn,
      createdAt: transfer.createdAt,
      description: transfer.note || "人員間資金移轉",
      paymentMethod: transfer.paymentMethod,
      note: transfer.note,
      personId: null,
      fromPersonId: transfer.fromPersonId,
      toPersonId: transfer.toPersonId,
      amount: transfer.amount,
      delta,
      runningBalance: null,
    });
  }

  let balance = 0;
  let deposited = 0;
  let withdrawn = 0;
  const chronological = activities
    .sort((left, right) =>
      left.occurredOn.localeCompare(right.occurredOn) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id))
    .map((activity) => {
      if (activity.status !== "posted") return activity;
      if (activity.delta > 0) deposited += activity.delta;
      if (activity.delta < 0) withdrawn += Math.abs(activity.delta);
      balance += activity.delta;
      return { ...activity, runningBalance: balance };
    });

  return { deposited, withdrawn, balance, activities: sortCashbookActivities(chronological, "desc") };
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
    return sum;
  }, 0);
}

export const formatMoney = (amount: number) =>
  new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(amount);
