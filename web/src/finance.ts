import type { Category, FundTransfer, LedgerEntry, Person, PersonCashflowSummary } from "./types";

export interface Totals {
  planned: number;
  received: number;
  spent: number;
  pending: number;
  returned: number;
  pendingRefund: number;
  cashBalance: number;
  budgetRemaining: number;
}

export function calculateTotals(categories: Category[], entries: LedgerEntry[]): Totals {
  const planned = categories.reduce((sum, category) => sum + category.plannedAmount, 0);
  let received = 0;
  let spent = 0;
  let pending = 0;
  let returned = 0;
  let pendingRefund = 0;

  for (const entry of entries) {
    if (entry.status === "void") continue;
    if (entry.kind === "income" && entry.status === "posted") received += entry.amount;
    if (entry.kind === "expense") {
      if (entry.status === "posted") spent += entry.amount;
      if (entry.status === "pending") pending += entry.amount;
    }
    if (entry.kind === "refund" && entry.status === "posted") {
      spent -= entry.amount;
      returned += entry.amount;
    }
    if (entry.kind === "refund" && entry.status === "pending") pendingRefund += entry.amount;
  }

  return {
    planned,
    received,
    spent,
    pending,
    returned,
    pendingRefund,
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

export function calculatePersonCashflows(
  people: Person[],
  entries: LedgerEntry[],
  transfers: FundTransfer[],
): PersonCashflowSummary[] {
  return people.map((person) => {
    let expensePaid = 0;
    let fundingPaid = 0;
    let refundReceived = 0;
    let transferReceived = 0;
    let transferSent = 0;
    let pendingRefund = 0;
    let pendingTransferReceived = 0;
    let pendingTransferSent = 0;
    for (const entry of entries) {
      if (entry.personId !== person.id || entry.status === "void") continue;
      if (entry.status === "pending") {
        if (entry.kind === "refund") pendingRefund += entry.amount;
        continue;
      }
      if (entry.kind === "expense") expensePaid += entry.amount;
      if (entry.kind === "income") fundingPaid += entry.amount;
      if (entry.kind === "refund") refundReceived += entry.amount;
    }
    for (const transfer of transfers) {
      if (transfer.status === "void") continue;
      const isFrom = transfer.fromPersonId === person.id;
      const isTo = transfer.toPersonId === person.id;
      if (!isFrom && !isTo) continue;
      if (transfer.status === "pending") {
        if (isFrom) pendingTransferSent += transfer.amount;
        if (isTo) pendingTransferReceived += transfer.amount;
        continue;
      }
      if (isFrom) transferSent += transfer.amount;
      if (isTo) transferReceived += transfer.amount;
    }
    const settlement = expensePaid + transferSent - refundReceived - transferReceived;
    return {
      person,
      expensePaid,
      fundingPaid,
      refundReceived,
      transferReceived,
      transferSent,
      pendingRefund,
      pendingTransferReceived,
      pendingTransferSent,
      settlement,
    };
  }).sort((left, right) => right.settlement - left.settlement || left.person.name.localeCompare(right.person.name, "zh-Hant"));
}
