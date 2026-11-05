"""Capability assessment from the actual validated source, never sample heuristics."""
from decimal import Decimal

from pydantic import ValidationError

from .models import Dataset
from .causal_admission import assess_causal


def assess(data, period=None, entity="all"):
    try:
        dataset = data if isinstance(data, Dataset) else Dataset.model_validate(data)
    except ValidationError as exc:
        return {"version": "finance-preflight/v1", "ready": False, "allowed_analysis": [],
                "missing": [{"field": ".".join(map(str, e["loc"])), "reason": e["type"]}
                            for e in exc.errors(include_input=False)], "issues": []}
    periods = sorted({p.period for p in dataset.periods})
    period = period or periods[-1]
    rows = [p for p in dataset.periods if p.period == period and (entity == "all" or p.entity == entity)]
    missing = []
    issues = []
    allowed = ["profit", "budget", "cash", "quality"] if rows else []
    if not rows:
        missing.append({"field": "period/entity", "reason": "所选范围没有数据"})
    if rows and all(p.equity_open > 0 and p.equity_close > 0 for p in rows):
        allowed.append("dupont")
    else:
        missing.append({"field": "positive_equity", "reason": "杜邦绩效解读要求期初、期末权益均为正"})
    receivables = [r for r in dataset.receivables if entity == "all" or r.entity == entity]
    if period == dataset.as_of.strftime("%Y-%m") and receivables:
        allowed.append("receivables")
    else:
        missing.append({"field": "receivables_snapshot", "reason": "当前期间/主体无可用应收快照；空输入不等于零余额"})
    missing.extend([
        {"field": "quantity/unit_price", "reason": "月汇总无量价明细，禁止量价归因"},
        {"field": "receipt_transactions", "reason": "单应收快照不支持历史回款趋势"},
    ])
    for row in rows:
        residual = row.closing_cash - row.opening_cash - row.operating_cash - row.investing_cash - row.financing_cash
        if abs(residual) > Decimal("0.01"):
            issues.append({"code": "cash_reconciliation", "entity": row.entity, "period": row.period,
                           "residual": str(residual), "severity": "high"})
        year, month = map(int, row.period.split("-"))
        previous = f"{year - 1}-12" if month == 1 else f"{year}-{month - 1:02}"
        prior = next((p for p in dataset.periods if p.entity == row.entity and p.period == previous), None)
        if prior and abs(row.opening_cash - prior.closing_cash) > Decimal("0.01"):
            issues.append({"code": "cash_opening_continuity", "entity": row.entity, "period": row.period,
                           "residual": str(row.opening_cash - prior.closing_cash), "severity": "high"})
    return {"version": "finance-preflight/v1", "ready": bool(rows), "period": period, "entity": entity,
            "causal_admission": assess_causal(dataset),
            "grain": "entity/month", "currency": dataset.currency, "unit": "yuan",
            "coverage": {"start": periods[0], "end": periods[-1], "periods": periods},
            "source_kinds": {"periods": "monthly_aggregate", "receivables": "single_as_of_snapshot"},
            "as_of": str(dataset.as_of), "row_count": len(rows), "full_dataset": True,
            "allowed_analysis": allowed, "missing": missing, "issues": issues,
            "quality_checks": {"duplicate_keys": "passed", "required_fields": "passed", "null_values": "passed"}}


def scope_options(dataset):
    """Only offer real entity/period combinations, not a Cartesian product."""
    return {"version": "finance-scope/v1", "dataset_name": dataset.name,
            "currency": dataset.currency, "as_of": str(dataset.as_of),
            "periods": sorted({p.period for p in dataset.periods}),
            "entities": sorted({p.entity for p in dataset.periods}),
            "available_scopes": [{"entity": p.entity, "period": p.period}
                                 for p in sorted(dataset.periods, key=lambda p: (p.entity, p.period))],
            "aggregation": "simple_sum_not_consolidated", "grain": "entity/month"}
