-- The first cash-flow screen accidentally saved placeholder question marks as payment methods.
-- Preserve the transfers themselves while presenting those legacy values as unspecified.
UPDATE fund_transfers
SET payment_method = ''
WHERE TRIM(payment_method) IN ('?', '??', '???', '????', 'Unspecified');
