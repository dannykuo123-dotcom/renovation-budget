import { calculateTotals, categorySpent } from "./finance";
import type { BudgetItem, BudgetSpace, Category, LedgerEntry } from "./types";

export interface BudgetOverview {
  ownerBudget: number;
  currentBudget: number;
  spent: number;
  available: number;
  estimateGap: number;
}

export interface BudgetCategoryCard {
  id: string | null;
  name: string;
  items: BudgetItem[];
  planned: number;
  spent: number;
}

export function calculateBudgetOverview(
  ownerBudget: number,
  spaces: BudgetSpace[],
  entries: LedgerEntry[],
): BudgetOverview {
  const totals = calculateTotals(spaces, entries);
  return {
    ownerBudget,
    currentBudget: totals.planned,
    spent: totals.spent,
    available: ownerBudget - totals.spent,
    estimateGap: ownerBudget - totals.planned,
  };
}

export function buildBudgetCategoryCards(
  categories: Category[],
  spaces: BudgetSpace[],
  entries: LedgerEntry[],
): BudgetCategoryCard[] {
  const items = spaces.flatMap((space) => space.items);
  const cards: BudgetCategoryCard[] = [...categories]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-Hant"))
    .map((category) => {
      const categoryItems = items
        .filter((item) => item.categoryId === category.id)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-Hant"));
      return {
        id: category.id,
        name: category.name,
        items: categoryItems,
        planned: categoryItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
        spent: categorySpent(category.id, entries),
      };
    });
  const unclassifiedItems = items
    .filter((item) => !item.categoryId)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-Hant"));
  if (unclassifiedItems.length) {
    cards.push({
      id: null,
      name: "待分類",
      items: unclassifiedItems,
      planned: unclassifiedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
      spent: entries.reduce((sum, entry) => (
        !entry.categoryId && entry.kind === "expense" && entry.status === "posted" ? sum + entry.amount : sum
      ), 0),
    });
  }
  return cards;
}

export function defaultBudgetSpace(spaces: BudgetSpace[]): BudgetSpace | undefined {
  return [...spaces].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-Hant"))[0];
}
