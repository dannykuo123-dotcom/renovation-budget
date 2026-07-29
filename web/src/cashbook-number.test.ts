import { describe, expect, it } from "vitest";
import { formatCashbookNumber } from "./cashbook-number";

describe("formatCashbookNumber", () => {
  it("formats an integer without a currency symbol", () => {
    expect(formatCashbookNumber(376681)).toBe("376,681");
  });

  it("preserves a negative balance sign", () => {
    expect(formatCashbookNumber(-14719)).toBe("-14,719");
  });
});
