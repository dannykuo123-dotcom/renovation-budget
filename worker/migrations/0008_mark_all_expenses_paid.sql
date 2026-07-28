-- Expenses represent money that has already left the project account.
-- Keep the status model simple by converting any legacy pending/void expense to posted.
UPDATE ledger_entries
SET status = 'posted', updated_at = datetime('now')
WHERE kind = 'expense' AND status <> 'posted';
