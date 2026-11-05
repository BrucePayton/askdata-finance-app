---
name: finance-budget
description: 预算差异归因，用于财务应用中心的确定性计算与结果解释。
---

# 预算差异归因

## 输入与前置条件

通过 finance_analyze 工具传入 AnalysisRequest：dataset、period、entity、app_id=budget。数据必须来自已经校验的主体/月汇总和应收快照，金额单位CNY元。也可先调用 finance_load_dataset 读取配置好的只读业务库。

## 计算口径

实际经营利润=预算经营利润+(实际收入−预算收入)+(预算成本−实际成本)+(预算费用−实际费用)。

## 执行步骤

1. 按相同主体、期间、币种对齐实际与预算，未月结必须说明实际截至日与全月预算不可直接做完成判断。
2. 三因素差异必须可加总复原经营利润差异；成本、费用节约贡献为正，超支贡献为负。
3. 缺少数量和单价时不进行量价拆解，不推断责任人；预算为零的完成率返回不可计算。

## 输出与证据

输出指标、主体明细、异常、适用限制及数据指纹。数值计算统一使用 core/modules/finance/engine.py，不让语言模型承担算术；解释必须引用期间、指标及对应明细。

## 查询参考

SQL仅供已授权的数据层适配，必须绑定参数，不拼接用户输入。MySQL 8，详见 assets/finance/sql/budget.sql。

## 边界

## 专业执行合同 v2.0.0

MCP执行时数据只来自安装绑定的数据库，模型传入的 `dataset` 会被忽略；只提交已确认的期间、主体和专题。HTTP自有数据导入测试与MCP真实数据库边界不同。

先调用 `finance_preflight(period, entity)`；只有本专题出现在 `allowed_analysis` 时调用 `finance_analyze`。预检不通过须返回 `missing` 补充清单；不得编造数据。质量专题可报告质量问题但不绕过无效输入校验。

加载本指令（skill.load）不是执行计算。只有实际工具返回 `skill_execution.calculation_executed=true` 且含数据指纹、期间主体、`calculation_contract`，才可引用计算结果。金额以 exact_amounts 和公式版本为复核依据。

所有事实引用同主体、同期间、同口径的数据证据；算术差异标为“贡献”，未验证业务原因标为“假设”。知识库方法引用不代替企业事实证据；政策版本冲突必须暂停确定性结论并请求裁决。

适用条件、反例及正常/拒绝测试ID见 `assets/finance/skill-contracts.json` 本 Skill 条目。当前月汇总不具备因果准入，读取 `preflight.causal_admission` 后只输出假设与补充证据。

综合报告由 finance-quality 作质量门禁，按数据允许能力组合经营、预算、现金、应收和杜邦章节；缺失章节标不可用。任何报告均保留编制/复核签署，不代表审计保证。

只读分析，不记账、不调整预算、不修改应收、不自动发送催收消息。输出是待人工复核的管理分析，不构成审计结论。
