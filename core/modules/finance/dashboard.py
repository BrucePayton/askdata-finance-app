"""Finance dashboard domain layer.

Dashboards are reusable query products.  Reports may consume one immutable
dashboard snapshot, but a dashboard is never stored as a report document.
"""
from __future__ import annotations

from html import escape
import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field


class DashboardComponent(BaseModel):
    component_id: str
    kind: Literal["kpi", "line", "waterfall", "aging", "dupont", "table", "entity_compare", "cash_quality", "risk"]
    title: str
    business_lens: str
    payload: dict[str, Any]


class FinanceDashboardSpec(BaseModel):
    schema_version: Literal["finance-dashboard/v1"] = "finance-dashboard/v1"
    component_registry_version: str = "1.1.0"
    title: str
    topic_id: str
    scope: dict[str, Any]
    data_fingerprint: str
    data_as_of: str
    refresh_mode: Literal["live"] = "live"
    components: list[DashboardComponent]
    deferred_components: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def component_catalog() -> dict:
    path = Path(__file__).resolve().parents[3] / "assets" / "finance" / "dashboard-components.json"
    return json.loads(path.read_text(encoding="utf-8"))


def build_finance_dashboard(result: dict, *, topic_id: str, title: str) -> dict:
    """Select components only when their required evidence is present."""
    registry = component_catalog()
    metrics = result.get("metrics") or {}
    components: list[DashboardComponent] = []
    deferred: list[dict[str, Any]] = []

    values = [[label, metrics.get(key)] for key, label in (
        ("revenue", "营业收入"), ("operating_profit", "管理口径经营利润"),
        ("operating_cash", "经营活动现金净流量"), ("overdue", "逾期应收"))
        if metrics.get(key) is not None]
    components.append(DashboardComponent(component_id="finance-kpis", kind="kpi",
        title="核心财务指标", business_lens="规模、盈利、现金与信用风险的同屏观察", payload={"rows": values}))

    if topic_id in {"profit", "budget", "cash", "quality"} and result.get("entities"):
        components.append(DashboardComponent(component_id="entity-performance", kind="entity_compare",
            title="主体经营表现对比", business_lens="同时比较收入规模、经营利润、预算达成和经营现金，识别结构分化",
            payload={"rows": result["entities"]}))
    if topic_id in {"profit", "cash", "dupont"} and metrics.get("net_profit") is not None:
        components.append(DashboardComponent(component_id="cash-profit-quality", kind="cash_quality",
            title="利润含金量", business_lens="对照净利润与经营活动现金净流量；比率仅作当期质量观察",
            payload={"net_profit": metrics["net_profit"], "operating_cash": metrics.get("operating_cash"),
                     "cash_conversion": metrics.get("cash_conversion")}))

    if topic_id in {"profit", "budget", "quality"} and result.get("trend"):
        components.append(DashboardComponent(component_id="revenue-profit-trend", kind="line",
            title="收入、预算与经营利润趋势", business_lens="连接销售达成、成本费用约束与利润结果",
            payload={"rows": result["trend"], "x": "period", "series": ["revenue", "budget", "profit"]}))
    if topic_id in {"budget", "profit"} and result.get("bridge"):
        components.append(DashboardComponent(component_id="profit-variance-bridge", kind="waterfall",
            title="经营利润预算差异桥", business_lens="区分收入端、采购及生产成本端、期间费用端的算术贡献",
            payload={"rows": result["bridge"]}))
    if topic_id in {"receivables", "cash", "quality"} and metrics.get("receivables") is not None:
        components.append(DashboardComponent(component_id="receivables-aging", kind="aging",
            title="应收账龄与资金占用", business_lens="连接销售授信、交付验收、争议处理和催收回款",
            payload={"rows": result.get("aging") or []}))
    if topic_id == "receivables" and result.get("invoices"):
        by_customer: dict[str, float] = {}
        for row in result["invoices"]:
            by_customer[str(row.get("customer") or "未识别客户")] = by_customer.get(str(row.get("customer") or "未识别客户"), 0) + float(row.get("outstanding") or 0)
        components.append(DashboardComponent(component_id="customer-exposure", kind="table",
            title="客户信用风险敞口", business_lens="用于确定授信复核与回款跟进优先级",
            payload={"columns": ["客户", "应收余额"], "rows": [[k, v] for k, v in sorted(by_customer.items(), key=lambda x: -x[1])]}))
    if topic_id == "dupont" and all(metrics.get(k) is not None for k in ("net_margin", "asset_turnover", "equity_multiplier", "roe")):
        components.append(DashboardComponent(component_id="dupont-tree", kind="dupont",
            title="三因素杜邦分解", business_lens="从盈利能力、资产运营效率和资本结构解释权益回报构成",
            payload={"net_margin": metrics["net_margin"], "asset_turnover": metrics["asset_turnover"],
                     "equity_multiplier": metrics["equity_multiplier"], "roe": metrics["roe"]}))
    components.append(DashboardComponent(component_id="finance-risk-signals", kind="risk",
        title="经营与财务关注事项", business_lens="基于当前数据规则形成复核优先级，不替代审计判断",
        payload={"rows": result.get("issues") or []}))

    # Aging is exposure analysis, not an IFRS 9 expected-credit-loss forecast.
    if topic_id == "receivables":
        deferred.append({"component_id": "expected-credit-loss-forecast", "title": "坏账预测 / 预期信用损失",
            "reason": "缺少历史迁徙或违约率、EAD/LGD、客户特征以及当前与前瞻情景，不以账龄冒充预测。",
            "required_capabilities": ["historical_default_or_migration", "pd_lgd_ead", "current_conditions", "forward_looking_scenarios"]})
    if topic_id in {"profit", "budget"}:
        deferred.append({"component_id": "sales-driver-tree", "title": "销售量价结构与退货分析",
            "reason": "缺少订单、数量、单价、产品组合、退货及履约义务数据。",
            "required_capabilities": ["orders", "quantity_price_mix", "returns", "contract_performance_obligations"]})
    if topic_id in {"profit", "cash", "quality"}:
        deferred.append({"component_id": "procurement-working-capital", "title": "采购、库存与供应商资金链",
            "reason": "缺少采购价量、库存收发存、应付账龄和供应商付款条款数据。",
            "required_capabilities": ["purchase_orders", "inventory_movements", "accounts_payable", "supplier_payment_terms"]})

    return FinanceDashboardSpec(component_registry_version=registry["version"], title=title, topic_id=topic_id,
        scope={"period": result["period"], "entity": result["entity"]},
        data_fingerprint=result["fingerprint"], data_as_of=result["as_of"],
        components=components, deferred_components=deferred,
        warnings=list(result.get("warnings") or [])).model_dump()


def render_finance_dashboard_html(spec: dict) -> str:
    """Render a passive preview. The application refresh endpoint replaces it."""
    model = FinanceDashboardSpec.model_validate(spec)
    def money(value: Any) -> str:
        return "—" if value is None else f"{float(value) / 10000:,.1f} 万元"

    def line_chart(rows: list[dict], series: list[str]) -> str:
        if not rows or not series:
            return '<p class="empty">当前范围没有可绘制趋势。</p>'
        all_values = [float(row[key]) for row in rows for key in series if row.get(key) is not None]
        low, high = min(all_values or [0]), max(all_values or [1])
        span = high - low or 1
        width = 680
        colors = ["#19766b", "#78909a", "#c27b45"]
        paths = []
        for index, key in enumerate(series):
            points = []
            for position, row in enumerate(rows):
                if row.get(key) is None:
                    continue
                x = 25 + position * ((width - 50) / max(1, len(rows) - 1))
                y = 190 - (float(row[key]) - low) / span * 150
                points.append(f"{x:.1f},{y:.1f}")
            paths.append(f'<polyline points="{" ".join(points)}" fill="none" stroke="{colors[index % len(colors)]}" stroke-width="3"/>')
        labels = ''.join(f'<text x="{25 + i * ((width - 50) / max(1, len(rows) - 1)):.1f}" y="218">{escape(str(row.get("period", "")))}</text>' for i, row in enumerate(rows))
        legends = ''.join(f'<span style="--series:{colors[i % len(colors)]}">{escape(key)}</span>' for i, key in enumerate(series))
        return f'<div class="chart-legend">{legends}</div><svg class="line-chart" viewBox="0 0 {width} 230" role="img" aria-label="财务趋势图">{"".join(paths)}{labels}</svg>'

    def horizontal_bars(rows: list, label_key: str, value_key: str) -> str:
        pairs = [(str(row.get(label_key, "—")), float(row.get(value_key) or 0)) for row in rows if isinstance(row, dict)]
        scale = max([abs(value) for _, value in pairs] or [1]) or 1
        return '<div class="hbars">' + ''.join(
            f'<div><span>{escape(label)}</span><i><b style="width:{abs(value) / scale * 100:.1f}%"></b></i><strong>{money(value)}</strong></div>'
            for label, value in pairs) + '</div>'

    cards = []
    for component in model.components:
        payload = component.payload
        if component.kind == "kpi":
            body = '<div class="kpis">' + ''.join(
                f'<article><small>{escape(str(label))}</small><strong>{money(value)}</strong></article>'
                for label, value in payload.get("rows", [])) + '</div>'
        elif component.kind == "line":
            rows = payload.get("rows", [])
            body = line_chart(rows, payload.get("series", []))
            body += '<details><summary>查看同源趋势数据</summary>' + _dashboard_table(rows) + '</details>'
        elif component.kind == "entity_compare":
            rows = payload.get("rows", [])
            body = horizontal_bars(rows, "entity", "revenue") + '<details><summary>展开主体利润、预算和现金明细</summary>' + _dashboard_table(rows) + '</details>'
        elif component.kind == "cash_quality":
            conversion = payload.get("cash_conversion")
            body = '<div class="quality"><article><small>净利润</small><strong>' + money(payload.get("net_profit")) + '</strong></article>'
            body += '<article><small>经营现金净流量</small><strong>' + money(payload.get("operating_cash")) + '</strong></article>'
            body += '<article><small>现金转换率</small><strong>' + ("—" if conversion is None else f'{float(conversion):.2f} 倍') + '</strong></article></div>'
        elif component.kind == "waterfall":
            rows = payload.get("rows", [])
            body = horizontal_bars(rows, "label", "value") + '<details><summary>查看预算到实际的算术贡献</summary>' + _dashboard_table(rows) + '</details>'
        elif component.kind == "risk":
            rows = payload.get("rows", [])
            body = '<div class="risks">' + (''.join(f'<article class="{escape(str(row.get("severity", "medium")))}"><b>{escape(str(row.get("title", "待复核事项")))}</b><p>{escape(str(row.get("detail", "")))}</p></article>' for row in rows) if rows else '<p class="empty">当前规则未触发关注事项；不代表已取得审计保证。</p>') + '</div>'
        elif component.kind == "dupont":
            formatted = (("net_margin", "净利率", ".2%"), ("asset_turnover", "资产周转率", ".4f"),
                         ("equity_multiplier", "权益乘数", ".4f"), ("roe", "ROE", ".2%"))
            body = '<div class="dupont">' + ''.join(
                f'<span><b>{label}</b><strong>{format(float(payload[key]), pattern)}</strong></span>'
                for key, label, pattern in formatted) + '</div>'
        elif component.kind == "aging":
            rows = payload.get("rows", [])
            body = horizontal_bars(rows, "label", "value") + '<details><summary>查看账龄笔数与余额</summary>' + _dashboard_table(rows) + '</details>'
        else:
            rows = payload.get("rows", [])
            if rows and isinstance(rows[0], dict):
                columns = list(rows[0].keys())
                values = [[row.get(column) for column in columns] for row in rows]
            else:
                columns, values = payload.get("columns", []), rows
            body = '<table><thead><tr>' + ''.join(f'<th>{escape(str(c))}</th>' for c in columns) + '</tr></thead><tbody>' + ''.join(
                '<tr>' + ''.join(f'<td>{escape(str(v))}</td>' for v in row) + '</tr>' for row in values[:100]) + '</tbody></table>'
        cards.append(f'<section class="component component-{component.kind}"><span class="kind">{escape(component.kind.replace("_", " "))}</span><h2>{escape(component.title)}</h2><p>{escape(component.business_lens)}</p>{body}</section>')
    deferred = ''.join(f'<li><b>{escape(item["title"])}</b>：{escape(item["reason"])}</li>' for item in model.deferred_components)
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{{margin:0;background:#eef3f2;color:#173b3b;font:15px system-ui}}main{{max-width:1320px;margin:auto;padding:28px}}header{{padding:28px 30px;border-radius:18px;background:linear-gradient(120deg,#123b46,#17695f);color:white}}header p{{color:#d5e9e5}}.dashboard-grid{{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px;margin-top:18px}}section{{background:white;border:1px solid #dce6e1;border-radius:14px;padding:22px;grid-column:span 6;min-width:0}}.component-kpi,.component-risk{{grid-column:1/-1}}h1,h2{{margin:.2em 0}}h2{{font-size:19px}}p{{color:#60736d}}.kind{{float:right;text-transform:uppercase;font-size:10px;letter-spacing:.08em;color:#618078;background:#edf5f2;padding:5px 8px;border-radius:99px}}.kpis,.dupont,.quality{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}}article,.dupont span{{padding:16px;background:#eff6f2;border-radius:10px}}strong{{display:block;font-size:22px;margin-top:8px;font-variant-numeric:tabular-nums}}table{{border-collapse:collapse;width:100%;overflow:auto;font-size:12px}}th,td{{padding:9px;border-bottom:1px solid #e1e8e5;text-align:left}}details{{margin-top:14px}}summary{{cursor:pointer;color:#17695f}}.line-chart{{width:100%;height:auto;background:#f7faf9;border-radius:10px}}.line-chart text{{font-size:10px;fill:#69817c}}.chart-legend{{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;margin:12px 0}}.chart-legend span:before{{content:'';display:inline-block;width:16px;height:3px;background:var(--series);margin-right:5px;vertical-align:middle}}.hbars>div{{display:grid;grid-template-columns:minmax(90px,1fr) 3fr minmax(100px,auto);gap:10px;align-items:center;margin:10px 0;font-size:12px}}.hbars i{{height:10px;background:#e8efed;border-radius:9px;overflow:hidden}}.hbars b{{display:block;height:100%;background:linear-gradient(90deg,#2b8878,#72b7a8)}}.hbars strong{{font-size:12px;margin:0;text-align:right}}.risks{{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}}.risks article{{border-left:4px solid #d0a04d}}.risks article.high{{border-color:#b85145;background:#fff2ef}}.empty{{padding:20px;background:#f6f8f7;border-radius:10px}}.meta{{font-size:13px}}@media(max-width:760px){{main{{padding:12px}}.dashboard-grid{{display:block}}section{{margin:12px 0}}.hbars>div{{grid-template-columns:85px 1fr}}.hbars strong{{grid-column:2}}}}
</style></head><body><main><header><small>HENGCE · FINANCE DASHBOARD</small><h1>{escape(model.title)}</h1><p class="meta">动态看板 · 数据截至 {escape(model.data_as_of)} · 当前物化版本来自空间实时数据</p></header><div class="dashboard-grid">{''.join(cards)}{f'<section><h2>待数据能力满足后启用</h2><ul>{deferred}</ul></section>' if deferred else ''}</div><details><summary>数据校验标识</summary><code>{escape(model.data_fingerprint)}</code></details></main></body></html>'''


def _dashboard_table(rows: list[dict]) -> str:
    if not rows:
        return '<p class="empty">当前范围没有明细。</p>'
    columns = list(rows[0].keys())
    return '<div style="overflow:auto"><table><thead><tr>' + ''.join(f'<th>{escape(str(column))}</th>' for column in columns) + '</tr></thead><tbody>' + ''.join(
        '<tr>' + ''.join(f'<td>{escape(str(row.get(column, "—")))}</td>' for column in columns) + '</tr>' for row in rows[:100]) + '</tbody></table></div>'
