import type { EntryKind, FundTransfer, LedgerEntry } from "./types";

export interface DirectChoice<T extends string> {
  value: T;
  label: string;
}

export const paymentMethodChoices: DirectChoice<string>[] = [
  { value: "", label: "未指定" },
  { value: "銀行轉帳", label: "轉帳" },
  { value: "現金", label: "現金" },
  { value: "信用卡", label: "信用卡" },
  { value: "電子支付", label: "電子支付" },
];

export const transferStatusChoices: DirectChoice<FundTransfer["status"]>[] = [
  { value: "posted", label: "已完成" },
  { value: "pending", label: "待處理" },
];

export function defaultTransferPeople(
  personIds: string[],
  fromPersonId = "",
  toPersonId = "",
): Pick<FundTransfer, "fromPersonId" | "toPersonId"> {
  const resolvedFrom = fromPersonId || personIds[0] || "";
  const resolvedTo = toPersonId
    || personIds.find((personId) => personId !== resolvedFrom)
    || "";
  return { fromPersonId: resolvedFrom, toPersonId: resolvedTo };
}

export function compactPaymentMethodLabel(value: string): string {
  return paymentMethodChoices.find((choice) => choice.value === value)?.label ?? value;
}

export function entryStatusChoices(
  kind: EntryKind,
): DirectChoice<LedgerEntry["status"]>[] {
  return kind === "income"
    ? []
    : [
        { value: "posted", label: "已付款" },
        { value: "pending", label: "待付款" },
      ];
}

export function entryStatusValue(
  kind: EntryKind,
  selected: LedgerEntry["status"],
): LedgerEntry["status"] {
  return kind === "income" ? "posted" : selected;
}
