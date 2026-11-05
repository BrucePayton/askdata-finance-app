-- MySQL 8. Parameter placeholders must be bound by the caller.
SELECT customer, invoice, entity, outstanding, GREATEST(DATEDIFF(:as_of,due_date),0) AS days_overdue FROM finance_receivables ORDER BY days_overdue DESC, outstanding DESC;
