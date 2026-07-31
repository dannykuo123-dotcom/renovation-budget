import type { BudgetSpace } from "./types";

export function filterBudgetSpaces(
  spaces: BudgetSpace[],
  spaceId: string,
  categoryId: string,
): BudgetSpace[] {
  return spaces
    .filter((space) => !spaceId || space.id === spaceId)
    .map((space) => ({
      ...space,
      items: space.items.filter((item) => !categoryId || item.categoryId === categoryId),
    }))
    .filter((space) => !categoryId || space.items.length > 0);
}
