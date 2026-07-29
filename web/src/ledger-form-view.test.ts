import { describe, expect, it } from "vitest";
import {
  compactPaymentMethodLabel,
  defaultTransferPeople,
  entryStatusChoices,
  entryStatusValue,
  paymentMethodChoices,
  transferStatusChoices,
} from "./ledger-form-view";

describe("minimal ledger form choices", () => {
  it("keeps the single income status implicit", () => {
    expect(entryStatusChoices("income")).toEqual([]);
    expect(entryStatusValue("income", "pending")).toBe("posted");
  });

  it("exposes only the two useful expense states", () => {
    expect(entryStatusChoices("expense")).toEqual([
      { value: "posted", label: "已付款" },
      { value: "pending", label: "待付款" },
    ]);
  });

  it("keeps only actionable transfer states", () => {
    expect(transferStatusChoices).toEqual([
      { value: "posted", label: "已完成" },
      { value: "pending", label: "待處理" },
    ]);
  });

  it("defaults a new transfer to two different people", () => {
    expect(defaultTransferPeople(["danny", "hao"])).toEqual({
      fromPersonId: "danny",
      toPersonId: "hao",
    });
  });

  it("uses compact payment labels without changing submitted values", () => {
    expect(paymentMethodChoices.map((choice) => choice.value)).toEqual([
      "",
      "銀行轉帳",
      "現金",
      "信用卡",
      "電子支付",
    ]);
    expect(compactPaymentMethodLabel("銀行轉帳")).toBe("轉帳");
  });
});
