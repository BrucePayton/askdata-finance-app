-- MySQL 8. Parameter placeholders must be bound by the caller.
SELECT entity, period, COUNT(*) AS duplicate_count FROM finance_monthly GROUP BY entity, period HAVING COUNT(*) > 1;
