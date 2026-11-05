"""Financial invariants and API contracts; no external database required."""
import unittest
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError
from core.modules.finance.models import AnalysisRequest, Dataset
from core.modules.finance.engine import analyze, catalog, report_markdown, ASSET_ROOT
from core.modules.finance.server import app
from core.modules.finance.source import identifier


def dataset():
    return Dataset.model_validate({
        "name": "unit-test", "as_of": "2026-08-31", "source": "database",
        "periods": [{"period": "2026-08", "entity": "A", "revenue": 1000, "cost": 600, "opex": 100,
          "net_profit": 240, "budget_revenue": 1100, "budget_cost": 620, "budget_opex": 90,
          "operating_cash": 220, "investing_cash": -50, "financing_cash": -20,
          "opening_cash": 100, "closing_cash": 250,
          "assets_open": 1800, "assets_close": 2200, "equity_open": 900, "equity_close": 1100}],
        "receivables": []})


class FinanceTests(unittest.TestCase):
    def run_analysis(self, data=None, **kwargs):
        return analyze(AnalysisRequest(dataset=data or dataset(), period="2026-08", **kwargs))

    def test_budget_bridge_closes_and_signs_are_favorable(self):
        r = self.run_analysis()
        self.assertEqual(r["metrics"]["operating_profit"], 300)
        self.assertEqual(r["metrics"]["profit_variance"], -90)
        self.assertEqual(sum(b["value"] for b in r["bridge"][:-1]), r["bridge"][-1]["value"])
        self.assertEqual([b["value"] for b in r["bridge"][1:4]], [-100, 20, -10])

    def test_dupont_identity(self):
        m=self.run_analysis()["metrics"]
        self.assertAlmostEqual(m["net_margin"]*m["asset_turnover"]*m["equity_multiplier"],m["roe"])
        self.assertEqual(m["roe"],.24)

    def test_zero_denominators(self):
        d=dataset();d.periods[0].revenue=Decimal(0);d.periods[0].budget_revenue=Decimal(0);d.periods[0].net_profit=Decimal(0)
        m=self.run_analysis(d)["metrics"]
        for key in ["gross_margin","net_margin","revenue_attainment","cash_conversion"]:self.assertIsNone(m[key])

    def test_cash_gaps_cannot_cancel_between_entities(self):
        d=dataset();other=d.periods[0].model_copy(deep=True);other.entity="B";other.closing_cash+=10;d.periods[0].closing_cash-=10;d.periods.append(other)
        r=self.run_analysis(d)
        self.assertEqual(r["metrics"]["cash_gap"],0)
        self.assertEqual(len([i for i in r["issues"] if "现金勾稽" in i["title"]]),2)

    def test_aging_boundaries_and_cents(self):
        raw=dataset().model_dump(mode="json")
        raw["receivables"]=[{"invoice":str(days),"entity":"A","customer":"C","due_date":str(date(2026,8,31)-timedelta(days=days)),"outstanding":"0.10"} for days in [-1,0,1,30,31,60,61,90,91]]
        r=self.run_analysis(Dataset.model_validate(raw))
        self.assertEqual([b["count"] for b in r["aging"]],[2,2,2,2,1])
        self.assertEqual(r["metrics"]["receivables"],.9)
        self.assertEqual(r["metrics"]["overdue"],.7)

    def test_historical_snapshot_not_reused(self):
        d=dataset();d.periods[0].period="2026-07"
        r=analyze(AnalysisRequest(dataset=d,period="2026-07"))
        self.assertIsNone(r["metrics"]["receivables"])
        self.assertTrue(any("快照" in w for w in r["warnings"]))

    def test_duplicate_keys_rejected(self):
        raw=dataset().model_dump();raw["periods"]*=2
        with self.assertRaises(ValidationError):Dataset.model_validate(raw)

    def test_missing_fields_not_zero_filled(self):
        raw=dataset().model_dump();del raw["periods"][0]["net_profit"]
        with self.assertRaises(ValidationError):Dataset.model_validate(raw)

    def test_entity_filter_and_empty_period(self):
        with self.assertRaises(ValueError):self.run_analysis(entity="missing")

    def test_identifier_injection_rejected(self):
        with self.assertRaises(ValueError):identifier("finance_monthly; DROP TABLE x", "mysql")
        self.assertEqual(identifier("finance_monthly","mysql"),'`finance_monthly`')

    def test_skills_exist(self):
        for skill in catalog()["skills"]:
            self.assertTrue((ASSET_ROOT.parents[1]/skill["path"]).is_file())

    def test_report_topic_and_traceability(self):
        result=self.run_analysis(app_id="dupont");text=report_markdown(result)
        self.assertIn("杜邦",text);self.assertIn("专题指标",text);self.assertIn(result["fingerprint"],text);self.assertIn("未年化",text)

    def test_api_contract_and_validation(self):
        with TestClient(app) as client:
            response=client.post('/api/finance/analyze',json={"dataset":dataset().model_dump(mode="json"),"period":"2026-08"})
            self.assertEqual(response.status_code,200)
            self.assertEqual(client.post('/api/finance/analyze',json={}).status_code,422)
            self.assertEqual(client.get('/api/finance/skills/finance-budget').status_code,200)
            self.assertEqual(client.get('/api/finance/skills/not-found').status_code,404)

    def test_source_failure_does_not_leak_credentials(self):
        with patch('core.modules.finance.router.inspect_source',side_effect=RuntimeError('password-secret')):
            response=TestClient(app).get('/api/finance/source')
            self.assertEqual(response.status_code,503)
            self.assertNotIn('password-secret',response.text)


if __name__ == '__main__':unittest.main()
