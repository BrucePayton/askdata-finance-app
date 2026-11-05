import json
from pathlib import Path

import pytest

from core.modules.finance.engine import analyze, catalog
from core.modules.finance.models import AnalysisRequest, Dataset
from core.modules.finance.preflight import assess
from core.modules.finance.quality_evaluation import evaluate_claims
from test_finance import dataset

FIXTURE = json.loads((Path(__file__).parent / "fixtures/golden-v2.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["id"])
def test_gold_and_rejected_skill_paths(case):
    raw = dataset().model_dump(mode="json")
    mutation = case["mutation"]
    period = "2026-08"
    if mutation == "invoice":
        raw["receivables"] = [{"invoice": "I", "entity": "A", "customer": "C", "due_date": "2026-08-01", "outstanding": "12.34"}]
    elif mutation == "period":
        period = "2025-08"
    elif mutation == "budget":
        del raw["periods"][0]["budget_revenue"]
    elif mutation == "cash":
        raw["periods"][0]["closing_cash"] = None
    elif mutation == "historical":
        raw["periods"][0]["period"] = period = "2026-07"
    elif mutation == "equity":
        raw["periods"][0]["equity_open"] = "-10"
    elif mutation == "duplicate":
        raw["periods"] *= 2
    if case.get("reject"):
        with pytest.raises(ValueError):
            analyze(AnalysisRequest(dataset=Dataset.model_validate(raw), period=period, app_id=case["app"]))
    else:
        result = analyze(AnalysisRequest(dataset=Dataset.model_validate(raw), period=period, app_id=case["app"]))
        for key, value in case["expected"].items():
            assert result["metrics"][key] == pytest.approx(value, abs=0.01)
        assert result["skill_execution"]["calculation_executed"]


def test_every_skill_has_positive_and_negative_versioned_case():
    cases = {c["id"]: c for c in FIXTURE["cases"]}
    contracts = catalog()["skill_contracts"]
    assert len(contracts["skills"]) == 6
    for skill in contracts["skills"]:
        assert not cases[skill["positive_case"]].get("reject")
        assert cases[skill["negative_case"]]["reject"]
        assert skill["version"] == "2.0.0"


def test_quality_scores_and_locatable_failures():
    evidence = {"D": {"kind": "data", "metrics": {"profit": "300.00"}}, "M": {"kind": "method"}}
    good = [{"id": "fact", "grade": "fact", "evidence_ids": ["D"], "metric": "profit", "value": 300},
            {"id": "guess", "grade": "hypothesis", "evidence_ids": []}]
    score = evaluate_claims(good, evidence)
    assert score["passed"] and score["citation_validity"] == score["number_consistency"] == 1
    bad = [{"id": "bad", "grade": "fact", "evidence_ids": ["M", "gone"], "value": 999, "causal_assertion": True}]
    score = evaluate_claims(bad, evidence)
    assert not score["passed"] and score["unsupported_assertions"] == 1
    assert {f["rule"] for f in score["failures"]} >= {"invalid_citation", "number_mismatch", "unsupported_assertion"}
    assert all(f["claim_id"] == "bad" for f in score["failures"])
    assert not evaluate_claims(good, evidence, policy_conflicts=["policy-v1/v2"])["passed"]
    assert evaluate_claims([], {})["number_consistency"] is None


def test_actual_aggregate_data_never_implies_causal_admission():
    p = assess(dataset())
    gate = p["causal_admission"]
    assert not gate["admitted"] and gate["causal_effect"] is None
    assert gate["mode"] == "hypothesis_only"
    assert {r["rule"] for r in gate["required"]} >= {"identification", "refutation", "causal_graph", "tool_admission"}
    result = analyze(AnalysisRequest(dataset=dataset(), period="2026-08"))
    assert not result["preflight"]["causal_admission"]["admitted"]
    assert all(h["grade"] == "hypothesis" for h in gate["hypotheses"])
