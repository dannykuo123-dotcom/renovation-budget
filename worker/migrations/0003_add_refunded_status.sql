PRAGMA foreign_keys = OFF;

CREATE TABLE ledger_entries_refund_backup AS
SELECT * FROM ledger_entries;

CREATE TABLE attachments_refund_backup AS
SELECT * FROM attachments;

DROP TABLE attachments;
DROP TABLE ledger_entries;

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'refund')),
  status TEXT NOT NULL CHECK (status IN ('posted', 'pending', 'refunded', 'void')),
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

INSERT INTO ledger_entries
SELECT * FROM ledger_entries_refund_backup;

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

INSERT INTO attachments
SELECT * FROM attachments_refund_backup;

DROP TABLE attachments_refund_backup;
DROP TABLE ledger_entries_refund_backup;

PRAGMA foreign_keys = ON;
