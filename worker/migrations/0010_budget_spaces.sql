PRAGMA defer_foreign_keys = ON;

CREATE TABLE budget_spaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX budget_spaces_project_name_idx
  ON budget_spaces(project_id, name COLLATE NOCASE);
CREATE INDEX budget_spaces_project_sort_idx
  ON budget_spaces(project_id, sort_order);

INSERT INTO budget_spaces (id, project_id, name, sort_order, created_at, updated_at)
SELECT 'space-' || id, id, '未分空間', 1, created_at, updated_at
FROM projects;

CREATE TABLE budget_line_items_next (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES budget_spaces(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES budget_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  planned_amount INTEGER NOT NULL CHECK (planned_amount >= 0 AND planned_amount = quantity * unit_price),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO budget_line_items_next (
  id, project_id, space_id, category_id, name, quantity, unit_price, planned_amount, sort_order, created_at, updated_at
)
SELECT id, project_id, 'space-' || project_id, category_id, name, 1, planned_amount, planned_amount, sort_order, created_at, updated_at
FROM budget_line_items;

INSERT INTO budget_line_items_next (
  id, project_id, space_id, category_id, name, quantity, unit_price, planned_amount, sort_order, created_at, updated_at
)
SELECT
  'legacy-item-' || category.id,
  category.project_id,
  'space-' || category.project_id,
  category.id,
  '未拆分預算',
  1,
  category.planned_amount,
  category.planned_amount,
  1000 + category.sort_order,
  category.created_at,
  category.updated_at
FROM budget_categories category
WHERE category.planned_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM budget_line_items item WHERE item.category_id = category.id
  );

DROP TABLE budget_line_items;
ALTER TABLE budget_line_items_next RENAME TO budget_line_items;

CREATE INDEX budget_line_items_space_idx
  ON budget_line_items(space_id, sort_order);
CREATE INDEX budget_line_items_category_idx
  ON budget_line_items(category_id, sort_order);
