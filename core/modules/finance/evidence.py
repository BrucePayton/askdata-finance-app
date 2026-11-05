"""Generic claim/evidence snapshots: methodology is not enterprise fact evidence."""
from copy import deepcopy
import hashlib
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EvidenceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    label: str
    type: Literal["data", "methodology"]
    relation: Literal["supports", "refutes", "context"] = "supports"
    workspace_id: int | None = None
    version: str
    scope_hash: str
    snapshot_hash: str
    coverage: Literal["full_aggregate", "sample", "methodology"]
    url: str | None = None


class AnalysisClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: Literal["fact", "contribution", "hypothesis", "limitation"]
    text: str = Field(min_length=1)
    status: Literal["supported", "refuted", "unverified", "unreviewable"] = "unverified"
    evidence_refs: list[EvidenceRef] = Field(default_factory=list)
    invalid_reasons: list[str] = Field(default_factory=list)


def stable_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), default=str).encode()).hexdigest()


def normalize_scope(scope):
    value = deepcopy(scope or {})
    if isinstance(value.get("entities"), list):
        value["entities"] = sorted(set(value["entities"]))
    return value


def evidence_ref(evidence, relation="supports"):
    return EvidenceRef(**{k: evidence[k] for k in (
        "id", "label", "type", "workspace_id", "version", "scope_hash", "snapshot_hash", "coverage")},
        relation=relation, url=evidence.get("url")).model_dump(mode="json", exclude_none=True)


def validate_claims(claims, evidence, *, workspace_id, scope, unavailable_ids=()):
    """Revalidate when reused: scope/version/permissions/snapshot/sample coverage."""
    by_id = {e["id"]: e for e in evidence}
    expected_scope = stable_hash(normalize_scope(scope))
    output = []
    for raw in claims:
        claim = AnalysisClaim.model_validate(raw).model_dump(mode="json", exclude_none=True)
        reasons, checked_refs, supported, refuted = [], [], False, False
        for ref in claim["evidence_refs"]:
            item = by_id.get(ref["id"])
            if item is None or ref["id"] in unavailable_ids:
                reasons.append("evidence_unavailable")
                continue
            if ref.get("workspace_id") != workspace_id or item.get("workspace_id") != workspace_id:
                reasons.append("workspace_access_mismatch")
                continue
            checked_refs.append(ref)
            if ref["scope_hash"] != expected_scope or item["scope_hash"] != expected_scope:
                reasons.append("analysis_scope_changed")
                continue
            if ref["snapshot_hash"] != item["snapshot_hash"] or stable_hash(item["snapshot"]) != item["snapshot_hash"]:
                reasons.append("evidence_snapshot_changed")
                continue
            if ref["version"] != item["version"]:
                reasons.append("evidence_version_changed")
                continue
            if ref["type"] != item["type"]:
                reasons.append("evidence_type_changed")
                continue
            if item["type"] == "methodology":
                if item["snapshot"].get("review_status") != "approved":
                    reasons.append("methodology_not_reviewed")
                continue
            if item["coverage"] != "full_aggregate":
                if claim["kind"] in ("fact", "contribution"):
                    reasons.append("sample_not_full_aggregate")
                continue
            supported |= ref["relation"] == "supports"
            refuted |= ref["relation"] == "refutes"
        claim["evidence_refs"] = checked_refs
        if "workspace_access_mismatch" in reasons:
            claim["text"] = "该结论引用了当前工作空间无权访问的证据，内容不可展示。"
        if reasons:
            claim["status"] = "unreviewable"
        elif supported and refuted:
            claim["status"] = "unverified"
            reasons.append("conflicting_evidence")
        elif refuted:
            claim["status"] = "refuted"
        elif supported and claim["kind"] in ("fact", "contribution"):
            claim["status"] = "supported"
        else:
            claim["status"] = "unverified"
            if claim["kind"] in ("fact", "contribution"):
                reasons.append("no_full_data_support")
        claim["invalid_reasons"] = sorted(set(reasons))
        output.append(claim)
    return output


def attach_finance_claims(result, *, workspace_id=None, scope=None, knowledge_evidence=None):
    """Call only on server-computed results; never infer completeness from a table.

    knowledge_evidence accepts governed retrieval chunks (text + knowledge_evidence).
    SQL is not fabricated: the query snapshot describes actual canonical selection.
    """
    output = deepcopy(result)
    preflight, contract = result.get("preflight") or {}, result.get("calculation_contract") or {}
    scope = normalize_scope(scope if scope is not None else {
        "entities": [] if result.get("entity") == "all" else [result.get("entity")],
        "period_start": result.get("period"), "period_end": result.get("period"),
        "currency": contract.get("currency", "CNY"), "unit": "ones",
        "consolidation_mode": "aggregate" if result.get("entity") == "all" else "single_entity",
        "budget_version": None})
    scope_hash = stable_hash(scope)
    snapshot = {k: deepcopy(result.get(k)) for k in ("metrics", "bridge", "aging", "calculation_contract", "preflight")}
    snapshot.update(scope=scope, query_snapshot={"kind": "canonical_dataset_selection",
        "fingerprint": result.get("fingerprint"), "source": result.get("source"),
        "dataset_name": result.get("dataset_name"), "filters": {"period": result.get("period"), "entity": result.get("entity")},
        "source_row_count": preflight.get("row_count"), "grain": preflight.get("grain"),
        "full_dataset": preflight.get("full_dataset") is True, "as_of": result.get("as_of")})
    fingerprint = stable_hash(snapshot)
    data = {"id": "data:" + fingerprint, "label": "所选主体期间全量汇总与确定性计算快照",
        "type": "data", "workspace_id": workspace_id, "version": contract.get("version", "unversioned"),
        "scope_hash": scope_hash, "snapshot_hash": fingerprint, "snapshot": snapshot,
        "coverage": "full_aggregate" if preflight.get("full_dataset") is True and preflight.get("ready") else "sample"}
    evidence, method_refs = [data], []
    for chunk in knowledge_evidence or []:
        reference, content = chunk.get("knowledge_evidence") or {}, chunk.get("text")
        if not reference or not isinstance(content, str):
            continue
        if reference.get("workspace_id") != workspace_id:
            continue
        if hashlib.sha256(content.encode()).hexdigest() != reference.get("content_hash"):
            continue
        method_snapshot = {**deepcopy(reference), "content": content}
        method = {"id": f"methodology:{reference['policy_version_id']}:{reference['content_hash']}",
            "label": chunk.get("document_name") or reference.get("policy_key") or "已审分析方法",
            "type": "methodology", "workspace_id": workspace_id, "version": str(reference["version"]),
            "scope_hash": scope_hash, "snapshot_hash": stable_hash(method_snapshot),
            "coverage": "methodology", "snapshot": method_snapshot}
        evidence.append(method)
        method_refs.append(evidence_ref(method, "context"))
    claims = []
    labels = {"revenue": "收入", "operating_profit": "管理口径经营利润", "net_profit": "净利润",
        "budget_profit": "预算经营利润", "profit_variance": "经营利润预算差异"}
    for key, label in labels.items():
        amount = (contract.get("exact_amounts") or {}).get(key)
        if amount is not None:
            claims.append({"id": f"claim:{scope_hash[:16]}:{key}", "kind": "fact",
                "text": f"{result.get('period')} {label}为 {amount} 元。", "evidence_refs": [evidence_ref(data), *method_refs]})
    if (contract.get("budget_bridge") or {}).get("balanced") is True:
        for index, item in enumerate(result.get("bridge") or []):
            if item.get("kind") == "delta":
                claims.append({"id": f"claim:{scope_hash[:16]}:bridge:{index}", "kind": "contribution",
                    "text": f"{item['label']}对经营利润预算差异的金额贡献为 {item['value']} 元；这是会计恒等式拆分，不是业务因果证明。",
                    "evidence_refs": [evidence_ref(data), *method_refs]})
    limitations = [str(w) for w in result.get("warnings") or []]
    limitations.extend(f"{m.get('field')}：{m.get('reason')}" for m in preflight.get("missing") or [])
    for index, warning in enumerate(limitations):
        claims.append({"id": f"claim:{scope_hash[:16]}:limit:{index}", "kind": "limitation",
                       "text": warning, "evidence_refs": [evidence_ref(data, "context")]})
    output["analysis_evidence"] = {"schema_version": "analysis-evidence/v1", "scope": scope,
        "scope_hash": scope_hash, "workspace_id": workspace_id, "evidence": evidence}
    output["analysis_claims"] = validate_claims(claims, evidence, workspace_id=workspace_id, scope=scope)
    return output


def claims_from_state(state):
    """Extract the agreed artifact namespace and validate current scope before reuse."""
    artifacts = state.get("agent_artifacts") or state.get("askdata_agent_artifacts") or {}
    data = artifacts.get("aksdata") or {}
    bundle, claims = data.get("analysis_evidence") or {}, data.get("analysis_claims") or []
    if not bundle or not claims:
        return {"schema_version": "analysis-evidence/v1", "claims": [], "evidence": [],
            "warnings": ["没有可验证的结论—证据绑定；不能把50行样本当作完整依据"]}
    scope = state.get("askdata_analysis_scope") or bundle.get("scope") or {}
    workspace_id = state.get("workspace_id")
    validated = validate_claims(claims, bundle.get("evidence") or [], workspace_id=workspace_id, scope=scope)
    visible = [e for e in bundle.get("evidence") or [] if e.get("workspace_id") == workspace_id]
    return {"schema_version": "analysis-evidence/v1", "scope": scope, "claims": validated,
            "evidence": visible, "warnings": []}
