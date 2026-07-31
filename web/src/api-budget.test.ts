import { describe, expect, it } from "vitest";
import {
  clearBudgetItems,
  createProject,
  loadDashboard,
  saveBudgetItem,
  saveCategory,
  saveEntry,
  saveOwnerBudget,
  savePerson,
} from "./api";

describe("clearBudgetItems", () => {
  it("clears only one project's items and preserves its owner budget, categories, and ledger", async () => {
    const projectA = await createProject({ name: "清空測試 A", address: "", status: "active" });
    const projectB = await createProject({ name: "清空測試 B", address: "", status: "active" });
    await saveOwnerBudget(projectA.id, 900000);
    const categoryA = await saveCategory(projectA.id, { name: "材料", color: "#176f61" });
    const categoryB = await saveCategory(projectB.id, { name: "施工", color: "#176f61" });
    const dashboardA = await loadDashboard(projectA.id);
    const dashboardB = await loadDashboard(projectB.id);
    await saveBudgetItem(projectA.id, {
      spaceId: dashboardA.spaces[0].id,
      categoryId: categoryA.id,
      name: "紗窗",
      quantity: 2,
      unitPrice: 5000,
    });
    await saveBudgetItem(projectB.id, {
      spaceId: dashboardB.spaces[0].id,
      categoryId: categoryB.id,
      name: "清運",
      quantity: 1,
      unitPrice: 10000,
    });
    const person = await savePerson(projectA.id, { name: "Danny", role: "", note: "", active: true });
    await saveEntry(projectA.id, {
      kind: "expense",
      status: "posted",
      description: "訂金",
      personId: person.id,
      amount: 3000,
      occurredOn: "2026-08-01",
      categoryId: categoryA.id,
      counterparty: "",
      paymentMethod: "現金",
      note: "",
    });

    await clearBudgetItems(projectA.id);

    const projectAAfter = await loadDashboard(projectA.id);
    const projectBAfter = await loadDashboard(projectB.id);
    expect(projectAAfter.spaces.flatMap((space) => space.items)).toEqual([]);
    expect(projectAAfter.project.ownerBudget).toBe(900000);
    expect(projectAAfter.categories).toHaveLength(1);
    expect(projectAAfter.entries).toHaveLength(1);
    expect(projectBAfter.spaces.flatMap((space) => space.items)).toHaveLength(1);
  });
});
