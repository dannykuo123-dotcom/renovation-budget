import type { CashbookActivity, CashbookActivityKind } from "./finance";

export type CashbookAmountTone = "income" | "expense" | "transfer";

export interface CashbookAmountPresentation {
  text: string;
  tone: CashbookAmountTone;
}

const numberFormatter = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 0,
});

export function personInitial(name: string): string {
  const [initial] = Array.from(name.trim());
  return initial ? initial.toLocaleUpperCase("zh-Hant") : "？";
}

export function cashbookAmountPresentation(
  amount: number,
  kind: CashbookActivityKind,
): CashbookAmountPresentation {
  const formatted = numberFormatter.format(amount);
  if (kind === "income") return { text: `＋${formatted}`, tone: "income" };
  if (kind === "expense") return { text: `−${formatted}`, tone: "expense" };
  return { text: `↔ ${formatted}`, tone: "transfer" };
}

export function activityInvolvesPerson(
  activity: Pick<CashbookActivity, "personId" | "fromPersonId" | "toPersonId">,
  personId: string | null,
): boolean {
  if (!personId) return true;
  return activity.personId === personId ||
    activity.fromPersonId === personId ||
    activity.toPersonId === personId;
}

export function activityMatchesCategory(
  activity: Pick<CashbookActivity, "source" | "kind">,
  entryCategoryId: string | null,
  selectedCategoryId: string,
): boolean {
  if (!selectedCategoryId) return true;
  return activity.source === "entry" &&
    activity.kind === "expense" &&
    entryCategoryId === selectedCategoryId;
}
