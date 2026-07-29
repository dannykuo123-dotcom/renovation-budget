import { describe, expect, it } from "vitest";
import {
  activityInvolvesPerson,
  activityMatchesCategory,
  cashbookAmountPresentation,
  personInitial,
} from "./cashbook-view";
import type { CashbookActivity } from "./finance";

const activity = (overrides: Partial<CashbookActivity> = {}): CashbookActivity => ({
  id: "activity",
  source: "entry",
  kind: "expense",
  status: "posted",
  occurredOn: "2026-07-24",
  createdAt: "2026-07-24T08:00:00Z",
  description: "塑膠門",
  paymentMethod: "銀行轉帳",
  note: "",
  personId: "hao",
  fromPersonId: null,
  toPersonId: null,
  amount: 800,
  delta: -800,
  runningBalance: 399200,
  ...overrides,
});

describe("personInitial", () => {
  it("uses the first visible character and uppercases Latin names", () => {
    expect(personInitial("  ming")).toBe("M");
    expect(personInitial("浩浩")).toBe("浩");
  });

  it("uses a fallback for a blank name", () => {
    expect(personInitial("   ")).toBe("？");
  });
});

describe("cashbookAmountPresentation", () => {
  it("formats income without a currency symbol", () => {
    expect(cashbookAmountPresentation(400000, "income")).toEqual({
      text: "＋400,000",
      tone: "income",
    });
  });

  it("formats expense as a negative amount", () => {
    expect(cashbookAmountPresentation(800, "expense")).toEqual({
      text: "−800",
      tone: "expense",
    });
  });

  it("formats every transfer direction as a neutral movement", () => {
    expect(cashbookAmountPresentation(23319, "transfer")).toEqual({
      text: "↔ 23,319",
      tone: "transfer",
    });
    expect(cashbookAmountPresentation(23319, "transfer-in")).toEqual({
      text: "↔ 23,319",
      tone: "transfer",
    });
    expect(cashbookAmountPresentation(23319, "transfer-out")).toEqual({
      text: "↔ 23,319",
      tone: "transfer",
    });
  });
});

describe("activityInvolvesPerson", () => {
  it("matches an entry's assigned person", () => {
    expect(activityInvolvesPerson(activity(), "hao")).toBe(true);
    expect(activityInvolvesPerson(activity(), "danny")).toBe(false);
  });

  it("matches both sides of a transfer", () => {
    const transfer = activity({
      source: "transfer",
      kind: "transfer",
      personId: null,
      fromPersonId: "danny",
      toPersonId: "hao",
      delta: 0,
    });

    expect(activityInvolvesPerson(transfer, "danny")).toBe(true);
    expect(activityInvolvesPerson(transfer, "hao")).toBe(true);
    expect(activityInvolvesPerson(transfer, "ming")).toBe(false);
  });

  it("matches every activity when no person is selected", () => {
    expect(activityInvolvesPerson(activity(), null)).toBe(true);
  });
});

describe("activityMatchesCategory", () => {
  it("matches all activity kinds when no category is selected", () => {
    expect(activityMatchesCategory(activity({ kind: "income" }), null, "")).toBe(true);
    expect(activityMatchesCategory(activity({ source: "transfer", kind: "transfer" }), null, "")).toBe(true);
  });

  it("only matches an expense assigned to the selected category", () => {
    expect(activityMatchesCategory(activity(), "materials", "materials")).toBe(true);
    expect(activityMatchesCategory(activity(), "construction", "materials")).toBe(false);
    expect(activityMatchesCategory(activity({ kind: "income" }), null, "materials")).toBe(false);
    expect(activityMatchesCategory(
      activity({ source: "transfer", kind: "transfer" }),
      null,
      "materials",
    )).toBe(false);
  });
});
