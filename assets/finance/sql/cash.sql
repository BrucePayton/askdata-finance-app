-- MySQL 8. Parameter placeholders must be bound by the caller.
SELECT entity, operating_cash, investing_cash, financing_cash, closing_cash-opening_cash-operating_cash-investing_cash-financing_cash AS cash_gap FROM finance_monthly WHERE period = :period;
