ALTER TABLE projects
ADD COLUMN owner_budget INTEGER NOT NULL DEFAULT 0 CHECK (owner_budget >= 0);
