"""Versioned Decimal calculation audit, emitted by the existing HTTP/MCP engine."""
from decimal import Decimal, ROUND_HALF_UP, localcontext


def contract(request):
    with localcontext() as ctx:
        ctx.prec = 50
        return _calculate(request)


def _calculate(request):
    rows = [p for p in request.dataset.periods if p.period == request.period and
            (request.entity == "all" or p.entity == request.entity)]
    total = lambda field: sum((getattr(p, field) for p in rows), Decimal(0))
    amount = lambda n: format(n.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), "f")
    ratio = lambda n, d: format((n / d).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP), "f") if d > 0 else None
    revenue, cost, opex = total("revenue"), total("cost"), total("opex")
    profit = revenue - cost - opex
    budget_profit = total("budget_revenue") - total("budget_cost") - total("budget_opex")
    deltas = [revenue - total("budget_revenue"), total("budget_cost") - cost, total("budget_opex") - opex]
    residual = profit - budget_profit - sum(deltas)
    assets = (total("assets_open") + total("assets_close")) / 2
    equity = (total("equity_open") + total("equity_close")) / 2
    equity_ok = all(p.equity_open > 0 and p.equity_close > 0 for p in rows)
    dupont = (total("net_profit") / revenue) * (revenue / assets) * (assets / equity) if revenue > 0 and equity_ok else None
    return {
        "version": "finance-calculation/v2", "formula_version": "finance-2.0.0",
        "currency": request.dataset.currency, "amount_unit": "yuan", "period": request.period,
        "period_basis": "monthly_not_annualized", "rounding": "ROUND_HALF_UP",
        "amount_precision": 2, "ratio_precision": 8, "null_policy": "unavailable_not_zero",
        "aggregation": "simple_sum_not_consolidated",
        "profit_basis": "revenue_minus_cost_minus_opex_not_statutory_operating_profit",
        "exact_amounts": {"revenue": amount(revenue), "operating_profit": amount(profit),
                          "net_profit": amount(total("net_profit")), "budget_profit": amount(budget_profit),
                          "profit_variance": amount(profit - budget_profit),
                          **{key: amount(total(key)) for key in ("opening_cash", "closing_cash", "operating_cash", "investing_cash", "financing_cash")}},
        "budget_bridge": {"formula": "actual_operating_profit-budget_operating_profit=revenue_delta-cost_delta-opex_delta",
                          "components": [amount(d) for d in deltas], "residual": amount(residual),
                          "tolerance": "0.01", "balanced": abs(residual) <= Decimal("0.01")},
        "cash_reconciliation": [{"entity": p.entity, "formula": "closing-opening-operating-investing-financing",
                                 "residual": amount(p.closing_cash-p.opening_cash-p.operating_cash-p.investing_cash-p.financing_cash)} for p in rows],
        "dupont": {"formula": "net_margin*asset_turnover*equity_multiplier=net_profit/average_equity",
                   "roe": ratio(total("net_profit"), equity) if equity_ok else None,
                   "residual": ratio(abs(dupont-total("net_profit")/equity), Decimal(1)) if dupont is not None else None,
                   "status": "available" if dupont is not None else "unavailable",
                   "unavailable_reason": None if dupont is not None else "revenue_zero_or_nonpositive_equity"},
        "review_status": "methodology_requires_finance_owner_signoff",
    }
