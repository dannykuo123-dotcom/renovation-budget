import { describe, expect, it } from "vitest";
import { buildBudgetCategoryCards, calculateBudgetOverview, defaultBudgetSpace } from "./budget-category-view";
import type { BudgetSpace, Category, LedgerEntry } from "./types";

const categories: Category[] = [
  { id: "labor", name: "施工", color: "#16776a", sortOrder: 1 },
  { id: "material", name: "材料", color: "#315e9c", sortOrder: 2 },
  { id: "food", name: "餐費", color: "#b27b28", sortOrder: 3 },
];

const spaces: BudgetSpace[] = [
  {
    id: "default",
    name: "未分空間",
    sortOrder: 2,
    items: [
      { id: "cleanup", spaceId: "default", categoryId: "labor", name: "清運費", quantity: 1, unitPrice: 100000, plannedAmount: 100000, sortOrder: 1 },
      { id: "screen", spaceId: "default", categoryId: "material", name: "紗窗", quantity: 2, unitPrice: 150000, plannedAmount: 300000, sortOrder: 2 },
    ],
  },
  {
    id: "legacy",
    name: "客廳",
    sortOrder: 1,
    items: [
      { id: "misc", spaceId: "legacy", categoryId: null, name: "待確認", quantity: 1, unitPrice: 50000, plannedAmount: 50000, sortOrder: 1 },
    ],
  },
];

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: crypto.randomUUID(),
    kind: "expense",
    status: "posted",
    description: "支出",
    amount: 120000,
    occurredOn: "2026-08-01",
    categoryId: "labor",
    personId: null,
    counterparty: "",
    paymentMethod: "",
    note: "",
    attachments: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("calculateBudgetOverview", () => {
  it("separates the owner's cap, current estimate, posted spend, and estimate gap", () => {
    const entries = [
      entry({ id: "posted", amount: 120000 }),
      entry({ id: "pending", status: "pending", amount: 9000 }),
      entry({ id: "income", kind: "income", amount: 800000 }),
      entry({ id: "void", status: "void", amount: 3000 }),
    ];

    expect(calculateBudgetOverview(600000, spaces, entries)).toEqual({
      ownerBudget: 600000,
      currentBudget: 450000,
      spent: 120000,
      available: 480000,
      estimateGap: 150000,
    });
  });
});

describe("buildBudgetCategoryCards", () => {
  it("keeps empty categories and groups items and posted spend by category", () => {
    const cards = buildBudgetCategoryCards(categories, spaces, [
      entry({ id: "labor-spend", categoryId: "labor", amount: 120000 }),
      entry({ id: "material-pending", categoryId: "material", status: "pending", amount: 50000 }),
    ]);

    expect(cards.map((card) => ({
      id: card.id,
      name: card.name,
      itemIds: card.items.map((item) => item.id),
      planned: card.planned,
      spent: card.spent,
    }))).toEqual([
      { id: "labor", name: "施工", itemIds: ["cleanup"], planned: 100000, spent: 120000 },
      { id: "material", name: "材料", itemIds: ["screen"], planned: 300000, spent: 0 },
      { id: "food", name: "餐費", itemIds: [], planned: 0, spent: 0 },
      { id: null, name: "待分類", itemIds: ["misc"], planned: 50000, spent: 0 },
    ]);
  });

  it("does not add an unclassified card when every item has a category", () => {
    const classifiedSpaces = spaces.map((space) => ({
      ...space,
      items: space.items.filter((item) => item.categoryId),
    }));

    expect(buildBudgetCategoryCards(categories, classifiedSpaces, []).some((card) => card.id === null)).toBe(false);
  });
});

describe("defaultBudgetSpace", () => {
  it("returns the first space by sort order without mutating input", () => {
    expect(defaultBudgetSpace(spaces)?.id).toBe("legacy");
    expect(spaces.map((space) => space.id)).toEqual(["default", "legacy"]);
  });
});
