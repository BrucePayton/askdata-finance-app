-- MySQL 8. Parameter placeholders must be bound by the caller.
SELECT period, entity, revenue, revenue-cost AS gross_profit, revenue-cost-opex AS operating_profit, (revenue-cost)/NULLIF(revenue,0) AS gross_margin, operating_cash/NULLIF(net_profit,0) AS cash_conversion FROM finance_monthly WHERE period = :period;
