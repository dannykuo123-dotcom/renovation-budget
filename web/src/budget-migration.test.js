import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("../../worker/migrations/0010_budget_spaces.sql", import.meta.url));
const migration = readFileSync(migrationPath, "utf8");

describe("0010 budget spaces migration", () => {
  it("uses D1-compatible deferred foreign-key validation", () => {
    expect(migration).toContain("PRAGMA defer_foreign_keys = ON;");
    expect(migration).not.toContain("PRAGMA foreign_keys = OFF;");
  });

  it("preserves totals, detailed items, zero budgets, and ledger category links", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE budget_categories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        planned_amount INTEGER NOT NULL,
        color TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE budget_line_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        planned_amount INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE ledger_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        category_id TEXT REFERENCES budget_categories(id) ON DELETE SET NULL
      );
      INSERT INTO projects VALUES ('p1', '2026-01-01', '2026-01-01');
      INSERT INTO budget_categories VALUES
        ('c1', 'p1', '材料', 100, '#000000', 1, '2026-01-01', '2026-01-01'),
        ('c2', 'p1', '施工', 500, '#000000', 2, '2026-01-01', '2026-01-01'),
        ('c3', 'p1', '餐費', 0, '#000000', 3, '2026-01-01', '2026-01-01');
      INSERT INTO budget_line_items VALUES
        ('i1', 'p1', 'c1', '燈具', 40, 1, '2026-01-01', '2026-01-01'),
        ('i2', 'p1', 'c1', '紗窗', 60, 2, '2026-01-01', '2026-01-01');
      INSERT INTO ledger_entries VALUES ('e1', 'p1', 'c1');
    `);

    const before = db.prepare("SELECT SUM(planned_amount) AS total FROM budget_categories").get().total;
    db.exec(`BEGIN;\n${migration}\nCOMMIT;`);
    const after = db.prepare("SELECT SUM(planned_amount) AS total FROM budget_line_items").get().total;

    expect(after).toBe(before);
    expect(db.prepare("SELECT name FROM budget_spaces").all()).toEqual([{ name: "未分空間" }]);
    expect(db.prepare("SELECT name, quantity, unit_price, category_id FROM budget_line_items ORDER BY sort_order").all()).toEqual([
      { name: "燈具", quantity: 1, unit_price: 40, category_id: "c1" },
      { name: "紗窗", quantity: 1, unit_price: 60, category_id: "c1" },
      { name: "未拆分預算", quantity: 1, unit_price: 500, category_id: "c2" },
    ]);
    expect(db.prepare("SELECT category_id FROM ledger_entries WHERE id = 'e1'").get()).toEqual({ category_id: "c1" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});