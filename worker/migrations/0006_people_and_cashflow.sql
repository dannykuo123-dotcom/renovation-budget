ALTER TABLE ledger_entries ADD COLUMN person_id TEXT REFERENCES people(id);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name COLLATE NOCASE)
);

CREATE INDEX IF NOT EXISTS people_project_active_idx ON people(project_id, active, name);

INSERT OR IGNORE INTO people (id, project_id, name, role, note, active, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  project_id,
  TRIM(counterparty),
  '',
  '',
  1,
  MIN(created_at),
  MAX(updated_at)
FROM ledger_entries
WHERE TRIM(counterparty) <> ''
GROUP BY project_id, TRIM(counterparty);

UPDATE ledger_entries
SET person_id = (
  SELECT p.id
  FROM people p
  WHERE p.project_id = ledger_entries.project_id
    AND p.name = TRIM(ledger_entries.counterparty) COLLATE NOCASE
)
WHERE TRIM(counterparty) <> '';

CREATE TABLE IF NOT EXISTS fund_transfers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_person_id TEXT NOT NULL REFERENCES people(id),
  to_person_id TEXT NOT NULL REFERENCES people(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  occurred_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('posted', 'pending', 'void')),
  payment_method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (from_person_id <> to_person_id)
);

CREATE INDEX IF NOT EXISTS fund_transfers_project_date_idx ON fund_transfers(project_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS fund_transfers_from_idx ON fund_transfers(from_person_id);
CREATE INDEX IF NOT EXISTS fund_transfers_to_idx ON fund_transfers(to_person_id);
