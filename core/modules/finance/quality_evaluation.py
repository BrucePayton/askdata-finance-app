"""Versioned, deterministic evaluation for isolated finance report acceptance tests."""
from decimal import Decimal, InvalidOperation


def evaluate_claims(claims, evidence, *, policy_conflicts=()):
    """Evidence contains authorized snapshot ids and optional exact metric values.

    This is an acceptance evaluator, not an authorization oracle or an LLM judge.
    Missing denominators yield None, not a misleading 100% success score.
    """
    citations = valid_citations = numeric = consistent = unsupported = 0
    failures = []
    for index, claim in enumerate(claims):
        identifier = claim.get("id", str(index))
        refs = claim.get("evidence_ids", [])
        citations += len(refs)
        valid = [ref for ref in refs if ref in evidence and evidence[ref].get("valid", True)]
        valid_citations += len(valid)
        grade = claim.get("grade")
        if grade not in {"fact", "contribution", "hypothesis"}:
            failures.append({"claim_id": identifier, "rule": "claim_grade"})
        factual_refs = [ref for ref in valid if evidence[ref].get("kind") == "data"]
        ungrounded = (grade in {"fact", "contribution"} and not factual_refs) or claim.get("causal_assertion", False)
        if policy_conflicts and grade != "hypothesis":
            ungrounded = True
            failures.append({"claim_id": identifier, "rule": "policy_conflict"})
        if ungrounded:
            unsupported += 1
            failures.append({"claim_id": identifier, "rule": "unsupported_assertion"})
        if len(valid) != len(refs):
            failures.append({"claim_id": identifier, "rule": "invalid_citation"})
        if "value" in claim:
            numeric += 1
            try:
                value = Decimal(str(claim["value"]))
                matches = any(value.is_finite() and
                              abs(value - Decimal(str(evidence[ref].get("metrics", {}).get(claim.get("metric"))))) <= Decimal("0.01")
                              for ref in factual_refs)
            except (InvalidOperation, ValueError, TypeError):
                matches = False
            if matches:
                consistent += 1
            else:
                failures.append({"claim_id": identifier, "rule": "number_mismatch"})
    return {"version": "finance-quality-eval/v1", "passed": not failures, "failures": failures,
            "citation_validity": valid_citations / citations if citations else None,
            "number_consistency": consistent / numeric if numeric else None,
            "unsupported_assertions": unsupported, "claim_count": len(claims)}
