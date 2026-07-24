CREATE TABLE IF NOT EXISTS budget_line_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  planned_amount INTEGER NOT NULL CHECK (planned_amount >= 0),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS budget_line_items_category_idx
  ON budget_line_items(category_id, sort_order);
