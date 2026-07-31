import { describe, expect, it } from "vitest";
import { filterBudgetSpaces } from "./budget-view";

const spaces = [
  {
    id: "living-room",
    name: "客廳",
    sortOrder: 1,
    items: [
      { id: "lamp", spaceId: "living-room", categoryId: "material", name: "淘寶吊燈", quantity: 2, unitPrice: 3200, plannedAmount: 6400, sortOrder: 1 },
      { id: "cleanup", spaceId: "living-room", categoryId: "labor", name: "清運費用", quantity: 1, unitPrice: 10000, plannedAmount: 10000, sortOrder: 2 },
    ],
  },
  {
    id: "kitchen",
    name: "廚房",
    sortOrder: 2,
    items: [
      { id: "screen", spaceId: "kitchen", categoryId: "material", name: "紗窗", quantity: 1, unitPrice: 10000, plannedAmount: 10000, sortOrder: 1 },
    ],
  },
];

describe("filterBudgetSpaces", () => {
  it("applies the selected space and category together", () => {
    const filtered = filterBudgetSpaces(spaces, "living-room", "material");

    expect(filtered.map((space) => ({
      id: space.id,
      items: space.items.map((item) => item.id),
    }))).toEqual([{ id: "living-room", items: ["lamp"] }]);
  });

  it("keeps an empty space visible when no category filter is active", () => {
    const emptySpace = { id: "bathroom", name: "浴室", sortOrder: 3, items: [] };

    expect(filterBudgetSpaces([...spaces, emptySpace], "", "").map((space) => space.id))
      .toEqual(["living-room", "kitchen", "bathroom"]);
  });

  it("does not return a space when none of its items match", () => {
    const filtered = filterBudgetSpaces(spaces, "kitchen", "labor");

    expect(filtered).toEqual([]);
  });
});
