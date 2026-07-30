import type { CashbookActivity } from "./finance";

export type CashbookViewMode = "list" | "split";
export type CashbookMobilePane = "income" | "expense";

export interface CashbookActivityGroups {
  income: CashbookActivity[];
  expense: CashbookActivity[];
  transfer: CashbookActivity[];
}

export function normalizeCashbookViewMode(
  value: string | undefined,
): CashbookViewMode {
  return value === "split" ? "split" : "list";
}

export function partitionCashbookActivities(
  activities: CashbookActivity[],
): CashbookActivityGroups {
  return {
    income: activities.filter((activity) =>
      activity.source === "entry" && activity.kind === "income"),
    expense: activities.filter((activity) =>
      activity.source === "entry" && activity.kind === "expense"),
    transfer: activities.filter((activity) => activity.source === "transfer"),
  };
}
