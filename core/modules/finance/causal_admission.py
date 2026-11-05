"""Fail-closed research admission: aggregate accounting data is not causal evidence.

This evaluates readiness, not causal effects. No externally supplied 'approved'
flag can unlock an unreviewed estimator or turn arithmetic bridges into causes.
"""


def assess_causal(dataset):
    periods = sorted({p.period for p in dataset.periods})
    entities = sorted({p.entity for p in dataset.periods})
    return {
        "version": "finance-causal-admission/v1", "admitted": False,
        "mode": "hypothesis_only", "causal_effect": None,
        "observed": {"period_count": len(periods), "entity_count": len(entities),
                     "row_count": len(dataset.periods), "grain": "entity/month"},
        "required": [
            {"rule": "treatment_and_time", "status": "missing", "detail": "需明确干预/处理变量、发生时点及先于结果的时间顺序"},
            {"rule": "sample_design", "status": "unreviewed", "detail": "需设计特定的有效样本量、重叠性、处理/对照及缺失机制审查；月数不等于独立样本数"},
            {"rule": "causal_graph", "status": "missing", "detail": "需版本化因果图、混杂因素与不可观测混杂假设的专业审核"},
            {"rule": "identification", "status": "not_run", "detail": "需在已审核图下识别目标估计量；识别失败必须停止"},
            {"rule": "refutation", "status": "not_run", "detail": "需安慰剂、子样本稳定性及未观测混杂敏感性检验，并保留失败结果"},
            {"rule": "tool_admission", "status": "not_installed", "detail": "DoWhy为候选工具，未审核安装前禁止执行"},
        ],
        "hypotheses": [
            {"text": "收入、成本、费用的变化可能与利润偏离有关", "grade": "hypothesis", "required_evidence": "订单量价、产品组合及期间对照；预算桥只说明算术贡献"},
            {"text": "收付款时点可能影响经营现金流", "grade": "hypothesis", "required_evidence": "逐笔收付款及合同信用条款；单应收快照不足"},
        ],
        "limitations": ["相关性、会计恒等式和差异桥不构成因果识别", "未执行因果估计，不能报告确定根因"],
        "method_source": "https://www.pywhy.org/dowhy/v0.9.1/user_guide/effect_inference/index.html",
    }
