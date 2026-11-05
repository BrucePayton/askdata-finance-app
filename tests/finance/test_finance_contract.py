from decimal import Decimal, localcontext
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from core.modules.finance.engine import analyze
from core.modules.finance.models import AnalysisRequest, Dataset
from core.modules.finance.preflight import assess, scope_options
from core.modules.finance.server import app
from test_finance import dataset


def calculate(data=None, **kwargs):
    return analyze(AnalysisRequest(dataset=data or dataset(), period="2026-08", **kwargs))


def test_full_source_scopes_and_capabilities():
    d = dataset()
    scopes = scope_options(d)
    assert scopes["available_scopes"] == [{"entity": "A", "period": "2026-08"}]
    p = assess(d)
    assert "dupont" in p["allowed_analysis"]
    assert "receivables" not in p["allowed_analysis"]
    assert {m["field"] for m in p["missing"]} >= {"quantity/unit_price", "receipt_transactions"}
    assert not assess(d, "2025-08")["ready"]


@pytest.mark.parametrize("problem", ["null", "duplicate", "currency", "missing"])
def test_invalid_raw_data_is_reported_not_zero_filled(problem):
    raw = dataset().model_dump()
    if problem == "null":
        raw["periods"][0]["net_profit"] = None
    elif problem == "duplicate":
        raw["periods"] *= 2
    elif problem == "currency":
        raw["currency"] = "USD"
    else:
        del raw["periods"][0]["net_profit"]
    p = assess(raw)
    assert not p["ready"] and p["missing"] and not p["allowed_analysis"]


def test_gold_contract_preserves_net_and_operating_profit():
    r = calculate()
    c = r["calculation_contract"]
    assert c["exact_amounts"]["net_profit"] == "240.00"
    assert c["exact_amounts"]["operating_profit"] == "300.00"
    assert c["budget_bridge"]["components"] == ["-100.00", "20.00", "-10.00"]
    assert c["budget_bridge"]["residual"] == "0.00"
    assert c["dupont"]["roe"] == "0.24000000"
    assert c["dupont"]["residual"] == "0.00000000"
    assert c["cash_reconciliation"][0]["residual"] == "0.00"
    assert r["metrics"]["receivables"] is None


@pytest.mark.parametrize("equity", ["0", "-100"])
def test_nonpositive_equity_not_meaningless_roe(equity):
    raw = dataset().model_dump()
    raw["periods"][0]["equity_open"] = equity
    d = Dataset.model_validate(raw)
    r = calculate(d)
    assert r["metrics"]["roe"] is None
    assert r["calculation_contract"]["dupont"]["status"] == "unavailable"
    with pytest.raises(ValueError):
        calculate(d, app_id="dupont")


def test_zero_budget_negative_profit_null_ratios():
    d = dataset()
    d.periods[0].budget_revenue = Decimal(0)
    d.periods[0].net_profit = Decimal(-10)
    r = calculate(d)
    assert r["metrics"]["revenue_attainment"] is None
    assert r["metrics"]["cash_conversion"] is None


def test_independent_precision_and_cross_period_isolation():
    d = dataset()
    other = d.periods[0].model_copy(deep=True)
    other.period = "2026-07"
    other.revenue = Decimal("99999999.99")
    d.periods.append(other)
    with localcontext() as context:
        context.prec = 4
        r = calculate(d)
    assert r["calculation_contract"]["exact_amounts"]["revenue"] == "1000.00"
    assert r["preflight"]["coverage"]["periods"] == ["2026-07", "2026-08"]


def test_cash_quality_does_not_net_entity_gaps():
    d = dataset()
    other = d.periods[0].model_copy(deep=True)
    other.entity = "B"
    other.closing_cash += 10
    d.periods[0].closing_cash -= 10
    d.periods.append(other)
    assert len(assess(d)["issues"]) == 2


def test_real_source_api_contract_and_error_redaction():
    client = TestClient(app)
    with patch("core.modules.finance.router.load_dataset", return_value=dataset()):
        assert client.get("/api/finance/scopes").json()["entities"] == ["A"]
        assert client.get("/api/finance/preflight?entity=missing").json()["ready"] is False
    with patch("core.modules.finance.router.load_dataset", side_effect=RuntimeError("password-secret")):
        response = client.get("/api/finance/scopes")
        assert response.status_code == 503 and "password-secret" not in response.text
