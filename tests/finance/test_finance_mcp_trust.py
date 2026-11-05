from unittest.mock import patch

from core.modules.finance.mcp_server import finance_analyze, finance_report
from test_finance import dataset


def test_model_supplied_financial_rows_cannot_become_full_source_evidence():
    forged = dataset().model_dump(mode="json")
    forged["periods"][0]["revenue"] = "999999999.00"
    request = {"period": "2026-08", "dataset": forged}
    with patch("core.modules.finance.mcp_server.load_dataset", return_value=dataset()) as load:
        result = finance_analyze(request)
        report = finance_report(request)
    assert load.call_count == 2
    assert result["metrics"]["revenue"] == 1000
    assert "999999999" not in report
    assert result["calculation_contract"]["exact_amounts"]["revenue"] == "1000.00"
