CREATE TABLE IF NOT EXISTS legacy_attachment_cleanup (
  object_key TEXT PRIMARY KEY
);

INSERT OR IGNORE INTO legacy_attachment_cleanup (object_key)
SELECT object_key FROM attachments;

DROP TABLE attachments;
DROP TABLE ledger_entries;
DROP TABLE budget_categories;
DROP TABLE project_settings;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  currency TEXT NOT NULL DEFAULT 'TWD',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX projects_status_idx ON projects(status, updated_at DESC);

CREATE TABLE budget_categories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  planned_amount INTEGER NOT NULL CHECK (planned_amount >= 0),
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX budget_categories_project_id_idx ON budget_categories(project_id, sort_order);

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'refund')),
  status TEXT NOT NULL CHECK (status IN ('posted', 'pending', 'void')),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  occurred_on TEXT NOT NULL,
  category_id TEXT REFERENCES budget_categories(id),
  counterparty TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ledger_entries_project_date_idx ON ledger_entries(project_id, occurred_on DESC);
CREATE INDEX ledger_entries_category_id_idx ON ledger_entries(category_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX attachments_entry_id_idx ON attachments(entry_id);
