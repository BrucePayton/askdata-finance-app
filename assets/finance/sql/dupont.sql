-- MySQL 8. Parameter placeholders must be bound by the caller.
SELECT entity, net_profit/NULLIF(revenue,0) AS net_margin, revenue/((assets_open+assets_close)/2) AS turnover, ((assets_open+assets_close)/2)/((equity_open+equity_close)/2) AS multiplier, net_profit/((equity_open+equity_close)/2) AS monthly_roe FROM finance_monthly WHERE period = :period;
