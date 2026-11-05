"""Deterministic calculations shared by HTTP and MCP. No LLM arithmetic."""
import calendar
import hashlib
import json
from decimal import Decimal, localcontext
from pathlib import Path

from .models import AnalysisRequest, Dataset
from .preflight import assess
from .calculation_contract import contract

ASSET_ROOT = Path(__file__).resolve().parents[3] / "assets" / "finance"


def catalog():
    result = json.loads((ASSET_ROOT / "catalog.json").read_text(encoding="utf-8"))
    result["skill_contracts"] = json.loads((ASSET_ROOT / "skill-contracts.json").read_text(encoding="utf-8"))
    return result


def ratio(numerator, denominator):
    return float(numerator / denominator) if denominator > 0 else None


def _analyze(request: AnalysisRequest):
    dataset = request.dataset
    preflight = assess(dataset, request.period, request.entity)
    if request.app_id not in ("overview", "quality") and request.app_id not in preflight["allowed_analysis"]:
        raise ValueError("所选数据不具备该专题的必要能力，请查看数据预检缺失清单")
    rows = [p for p in dataset.periods if p.period == request.period and (request.entity == "all" or p.entity == request.entity)]
    if not rows:
        raise ValueError("所选主体和期间没有数据")
    total = lambda field: sum((getattr(p, field) for p in rows), Decimal(0))
    revenue, cost, opex = total("revenue"), total("cost"), total("opex")
    profit = revenue - cost - opex
    budget_profit = total("budget_revenue") - total("budget_cost") - total("budget_opex")
    avg_assets = (total("assets_open") + total("assets_close")) / 2
    avg_equity = (total("equity_open") + total("equity_close")) / 2
    positive_equity = all(p.equity_open > 0 and p.equity_close > 0 for p in rows)
    cash_delta = total("operating_cash") + total("investing_cash") + total("financing_cash")
    cash_gap = total("closing_cash") - total("opening_cash") - cash_delta
    metrics = {
        "revenue": float(revenue), "gross_profit": float(revenue - cost),
        "gross_margin": ratio(revenue - cost, revenue), "operating_profit": float(profit),
        "net_profit": float(total("net_profit")), "net_margin": ratio(total("net_profit"), revenue),
        "budget_revenue": float(total("budget_revenue")),
        "revenue_attainment": ratio(revenue, total("budget_revenue")),
        "budget_profit": float(budget_profit), "profit_variance": float(profit - budget_profit),
        "operating_cash": float(total("operating_cash")), "closing_cash": float(total("closing_cash")),
        "cash_conversion": ratio(total("operating_cash"), total("net_profit")),
        "asset_turnover": ratio(revenue, avg_assets), "equity_multiplier": ratio(avg_assets, avg_equity) if positive_equity else None,
        "roe": ratio(total("net_profit"), avg_equity) if positive_equity else None, "cash_gap": float(cash_gap),
    }
    bridge = [
        {"label": "预算经营利润", "value": float(budget_profit), "kind": "total"},
        {"label": "收入差异", "value": float(revenue - total("budget_revenue")), "kind": "delta"},
        {"label": "成本差异", "value": float(total("budget_cost") - cost), "kind": "delta"},
        {"label": "费用差异", "value": float(total("budget_opex") - opex), "kind": "delta"},
        {"label": "实际经营利润", "value": float(profit), "kind": "total"},
    ]
    aging = [{"label": label, "value": Decimal(0), "count": 0} for label in ["未到期", "逾期 1–30 天", "逾期 31–60 天", "逾期 61–90 天", "逾期 90 天以上"]]
    invoices = []
    # Receivables are a single as-of snapshot, never reconstructed for earlier periods.
    snapshot_matches = request.period == dataset.as_of.strftime("%Y-%m")
    if snapshot_matches:
        for item in dataset.receivables:
            if request.entity != "all" and item.entity != request.entity:
                continue
            days = max(0, (dataset.as_of - item.due_date).days)
            bucket = 0 if days == 0 else 1 if days <= 30 else 2 if days <= 60 else 3 if days <= 90 else 4
            aging[bucket]["value"] += item.outstanding
            aging[bucket]["count"] += 1
            invoices.append({**item.model_dump(mode="json"), "days_overdue": days, "bucket": aging[bucket]["label"]})
    metrics["receivables"] = float(sum(b["value"] for b in aging)) if snapshot_matches and invoices else None
    metrics["overdue"] = float(sum(b["value"] for b in aging[1:])) if snapshot_matches and invoices else None
    issues = []
    for row in rows:
        gap = row.closing_cash - row.opening_cash - row.operating_cash - row.investing_cash - row.financing_cash
        if abs(gap) > Decimal("0.01"):
            issues.append({"severity": "high", "title": f"{row.entity} 现金勾稽不平", "detail": f"差额 {gap:,.2f} 元；检查汇率影响、受限资金及漏记流水。"})
    if metrics["revenue_attainment"] is not None and metrics["revenue_attainment"] < 1:
        issues.append({"severity": "medium", "title": "收入低于预算", "detail": f"达成率 {metrics['revenue_attainment']:.1%}；按客户、产品核查差异，当前数据不能证明量价原因。"})
    if profit < budget_profit:
        issues.append({"severity": "medium", "title": "经营利润未达预算", "detail": f"差额 {profit - budget_profit:,.2f} 元；收入、成本、费用贡献见差异桥。"})
    if aging[-1]["value"] > 0:
        issues.append({"severity": "high", "title": "存在逾期 90 天以上应收", "detail": f"余额 {aging[-1]['value']:,.2f} 元；核验争议与回款计划，不直接推定坏账。"})
    if total("operating_cash") < 0:
        issues.append({"severity": "high", "title": "经营现金净流出", "detail": "结合收付款节奏核查，当前月度数据不支持预测未来现金缺口。"})
    for bucket in aging:
        bucket["value"] = float(bucket["value"])
    trend = []
    for period in sorted({p.period for p in dataset.periods if p.period <= request.period}):
        group = [p for p in dataset.periods if p.period == period and (request.entity == "all" or p.entity == request.entity)]
        if group:
            trend.append({"period": period, "revenue": float(sum(p.revenue for p in group)), "budget": float(sum(p.budget_revenue for p in group)), "profit": float(sum(p.revenue - p.cost - p.opex for p in group))})
    entities = [{"entity": p.entity, "revenue": float(p.revenue), "cost": float(p.cost), "opex": float(p.opex), "profit": float(p.revenue - p.cost - p.opex), "budget": float(p.budget_revenue), "cash": float(p.operating_cash)} for p in rows]
    fingerprint = hashlib.sha256(dataset.model_dump_json().encode()).hexdigest()[:16]
    warnings = ["金额单位：人民币元；前端展示为万元。经营利润=收入−成本−期间费用，为管理口径，不等同法定营业利润。", "多主体为简单加总，未做内部交易抵销，不属于合并报表。", "杜邦指标使用当月利润与平均余额，未年化；正权益口径。现金转换率在净利润≤0时不宜用于绩效判断。"]
    last_day = calendar.monthrange(int(request.period[:4]), int(request.period[5:]))[1]
    if dataset.as_of.strftime("%Y-%m") == request.period and dataset.as_of.day < last_day:
        warnings.append("本月尚未月结：实际为截至日累计，预算为全月预算，达成率仅供进度观察。")
    if not snapshot_matches:
        warnings.append("应收只有数据截止日快照，所选历史期间的账龄不可用。")
    elif not invoices:
        warnings.append("所选主体未提供应收单据，零余额仅表示输入为空，不能证明不存在应收。")
    return {"app_id": request.app_id, "period": request.period, "entity": request.entity, "dataset_name": dataset.name, "source": dataset.source, "as_of": str(dataset.as_of), "fingerprint": fingerprint, "metrics": metrics, "bridge": bridge, "aging": aging, "invoices": sorted(invoices, key=lambda i: (-i["days_overdue"], -float(i["outstanding"]))), "trend": trend, "entities": entities, "issues": issues, "warnings": warnings, "lineage": {"input": "主体/月财务汇总 + 截止日应收快照", "version": "finance-1.0.0", "rows": len(rows), "formulas": "assets/finance/catalog.json", "snapshot": fingerprint}}


def analyze(request: AnalysisRequest):
    # Bound arithmetic precision independently of the caller's Decimal context.
    with localcontext() as context:
        context.prec = 50
        result = _analyze(request)
        result["preflight"] = assess(request.dataset, request.period, request.entity)
        result["calculation_contract"] = contract(request)
        result["skill_execution"] = {"version": "finance-skills/v2", "instruction_loaded_is_execution": False,
                                     "calculation_executed": True, "tool": "finance_analyze",
                                     "app_id": request.app_id, "evidence_fingerprint": result["fingerprint"]}
        result["lineage"]["version"] = "finance-2.0.0"
        from .evidence import attach_finance_claims
        return attach_finance_claims(result)


def report_markdown(result):
    m = result["metrics"]
    selected = next((a for a in catalog()["apps"] if a["id"] == result["app_id"]), None)
    title = selected["title"] if selected else "财务经营分析"
    lines = [f"# {result['period']} {title}报告", "", f"主体：{result['entity']} | 数据集：{result['dataset_name']} | 数据来源：{result['source']}", f"数据指纹：{result['fingerprint']} | 截止日：{result['as_of']} | 引擎：finance-1.0.0", "", "## 经营摘要", f"收入 {m['revenue']:,.2f} 元；管理口径经营利润 {m['operating_profit']:,.2f} 元；经营现金流 {m['operating_cash']:,.2f} 元。"]
    if selected:
        lines += ["", "## 专题指标与口径", "| 指标 | 结果 | 公式 |", "| --- | ---: | --- |"]
        for metric in catalog()["metrics"]:
            if metric["id"] in selected["metrics"]:
                value = m[metric["id"]]
                rendered = "不可计算" if value is None else f"{value * 100:,.2f}%" if metric["unit"] == "%" else f"{value:,.2f} {metric['unit']}"
                lines.append(f"| {metric['name']} | {rendered} | {metric['formula']} |")
    lines += ["", "## 预算差异归因（元）", "| 因素 | 金额 |", "| --- | ---: |"]
    lines += [f"| {b['label']} | {b['value']:,.2f} |" for b in result["bridge"]]
    lines += ["", "## 异常与复核建议"] + [f"- {i['title']}：{i['detail']}" for i in result["issues"]]
    if not result["issues"]:
        lines.append("- 当前规则未触发异常，不代表审计保证。")
    lines += ["", "## 应收账龄（元）"]
    lines += [f"- {b['label']}：{b['value']:,.2f}" for b in result["aging"]] if m["receivables"] is not None else ["历史快照不可用。"]
    lines += ["", "## 口径与限制"] + [f"- {w}" for w in result["warnings"]]
    lines += ["", "## 复核记录", "编制：待填写；复核：待填写；状态：规则生成草稿，尚未人工复核。", "本报告由确定性计算生成，AI解释需另外调用平台 AskData。"]
    if result.get("calculation_contract"):
        c = result["calculation_contract"]
        lines += ["", "## 确定性计算复核合同", f"公式版本：{c['formula_version']}；金额精度：{c['amount_precision']} 位；舍入：{c['rounding']}。",
                  f"预算桥残差：{c['budget_bridge']['residual']} 元；杜邦状态：{c['dupont']['status']}。",
                  "方法口径需由财务负责人签署复核，本系统不代替专业人员签署。"]
    return "\n".join(lines)
