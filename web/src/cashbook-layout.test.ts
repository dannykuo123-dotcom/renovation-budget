import { describe, expect, it } from "vitest";
import type { CashbookActivity, CashbookActivityKind } from "./finance";
import {
  normalizeCashbookViewMode,
  partitionCashbookActivities,
} from "./cashbook-layout";

function activity(
  id: string,
  kind: CashbookActivityKind,
  source: CashbookActivity["source"],
): CashbookActivity {
  return {
    id,
    kind,
    source,
    status: "posted",
    occurredOn: "2026-07-30",
    createdAt: "2026-07-30T00:00:00.000Z",
    description: id,
    paymentMethod: "",
    note: "",
    personId: null,
    fromPersonId: null,
    toPersonId: null,
    amount: 1,
    delta: 0,
    runningBalance: 0,
  };
}

describe("partitionCashbookActivities", () => {
  it("keeps transfers separate from project income and expense", () => {
    const income = activity("income", "income", "entry");
    const expense = activity("expense", "expense", "entry");
    const transfer = activity("transfer", "transfer-in", "transfer");

    expect(partitionCashbookActivities([income, expense, transfer])).toEqual({
      income: [income],
      expense: [expense],
      transfer: [transfer],
    });
  });

  it("falls back to list mode for unsupported cached values", () => {
    expect(normalizeCashbookViewMode("split")).toBe("split");
    expect(normalizeCashbookViewMode("cards")).toBe("list");
  });
});
