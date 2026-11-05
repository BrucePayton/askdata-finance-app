-- MySQL 8. Parameter placeholders must be bound by the caller.
SELECT entity, budget_revenue-budget_cost-budget_opex AS budget_profit, revenue-budget_revenue AS revenue_effect, budget_cost-cost AS cost_effect, budget_opex-opex AS expense_effect, revenue-cost-opex AS actual_profit FROM finance_monthly WHERE period = :period;
