-- Convert legacy expense/refunded rows into a paid expense plus a linked refund.
CREATE TABLE legacy_refunded_entries AS
SELECT * FROM ledger_entries
WHERE kind = 'expense' AND status = 'refunded';

ALTER TABLE ledger_entries
ADD COLUMN refund_of_entry_id TEXT REFERENCES ledger_entries(id);

CREATE INDEX ledger_entries_refund_source_idx ON ledger_entries(refund_of_entry_id);

UPDATE ledger_entries
SET status = 'posted'
WHERE kind = 'expense' AND status = 'refunded';

INSERT INTO ledger_entries (
  id, project_id, kind, status, description, amount, occurred_on, category_id,
  counterparty, payment_method, note, created_at, updated_at, refund_of_entry_id
)
SELECT
  'legacy-refund-' || id,
  project_id,
  'refund',
  'posted',
  '退貨：' || description,
  amount,
  occurred_on,
  category_id,
  counterparty,
  payment_method,
  note,
  created_at,
  updated_at,
  id
FROM legacy_refunded_entries;

DROP TABLE legacy_refunded_entries;
