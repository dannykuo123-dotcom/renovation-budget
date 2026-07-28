-- Earlier versions replaced every entry counterparty with the selected person's
-- name. Clear those generated duplicates so the UI does not show Person → Person.
-- Users can fill the actual vendor or remitter when they next edit the entry.
UPDATE ledger_entries
SET counterparty = '', updated_at = datetime('now')
WHERE person_id IS NOT NULL
  AND counterparty = (SELECT name FROM people WHERE people.id = ledger_entries.person_id);
