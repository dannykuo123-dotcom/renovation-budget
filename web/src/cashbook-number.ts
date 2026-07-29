const cashbookNumberFormatter = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 0,
});

export function formatCashbookNumber(amount: number): string {
  return cashbookNumberFormatter.format(amount);
}
