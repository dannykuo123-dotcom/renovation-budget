import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("../../worker/migrations/0011_owner_budget.sql", import.meta.url));

describe("0011 owner budget migration", () => {
  it("adds a zero owner budget without changing existing project data", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const db = new DatabaseSync(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        currency TEXT NOT NULL DEFAULT 'TWD',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE budget_line_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        planned_amount INTEGER NOT NULL
      );
      CREATE TABLE ledger_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL
      );
      INSERT INTO projects VALUES ('p1', '海德公園', '', 'active', 'TWD', '2026-01-01', '2026-01-01');
      INSERT INTO budget_line_items VALUES ('i1', 'p1', 120000);
      INSERT INTO ledger_entries VALUES ('e1', 'p1', 30000);
    `);

    db.exec(migration);

    expect(db.prepare("SELECT name, owner_budget FROM projects WHERE id = 'p1'").get()).toEqual({
      name: "海德公園",
      owner_budget: 0,
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM budget_line_items").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get()).toEqual({ count: 1 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});
