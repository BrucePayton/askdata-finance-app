import { isRecord, type AnalysisEvent } from './shared/analysis-room/reducer';

export interface FinancialClaim {
  id: string; kind: 'fact' | 'contribution' | 'hypothesis' | 'limitation'; text: string;
  amount?: string | number; currency?: string; status?: 'supported' | 'refuted' | 'unverified' | 'unreviewable';
  evidence_refs?: { label: string; url?: string; type?: string; relation?: string; version?: string; coverage?: string; scope_hash?: string }[];
}
interface BusinessPlan { status: string; steps: {id: string; title: string; status: string; gaps: string[]; refutations: string[]}[] }
export interface BusinessProgress { stages: string[]; claims: Record<string, FinancialClaim>; plan?: BusinessPlan }
export const initialBusinessProgress = (): BusinessProgress => ({ stages: [], claims: {} });
export function businessProgress(state: BusinessProgress, item: AnalysisEvent): BusinessProgress {
  const stages = item.event === 'stream_snapshot' ? [] : [...state.stages];
  const claims = item.event === 'stream_snapshot' ? {} : { ...state.claims };
  const rawPlan = item.event === 'orchestrator_stage' ? item.data.analysis_plan : item.event === 'stream_snapshot' && isRecord(item.data.latest) ? item.data.latest.analysis_plan : undefined;
  const plan = isRecord(rawPlan) && Array.isArray(rawPlan.steps) ? {
    status: String(rawPlan.status || 'planned'),
    steps: rawPlan.steps.flatMap(step => isRecord(step) && typeof step.id === 'string' && typeof step.title === 'string' ? [{
      id: step.id, title: step.title, status: String(step.status || 'pending'),
      gaps: Array.isArray(step.gaps) ? step.gaps.filter((v): v is string => typeof v === 'string') : [],
      refutations: Array.isArray(step.refutations) ? step.refutations.filter((v): v is string => typeof v === 'string') : [],
    }] : []),
  } : state.plan;
  const add = (stage: string) => { if (!stages.includes(stage)) stages.push(stage); };
  if (item.event === 'interrupt') add('口径确认');
  if (item.event === 'tool_call_result') add('数据核验');
  const artifacts = item.event === 'stream_snapshot' ? item.data.artifacts : item.event === 'agent_artifacts' ? item.data.artifacts : undefined;
  const aks = isRecord(artifacts) && isRecord(artifacts.aksdata) ? artifacts.aksdata : undefined;
  if (aks?.data_table || aks?.data_citations) add('数据核验');
  if (aks?.analysis_insights || aks?.analysis_claims) add('差异解释');
  if (aks?.report_card) add('报告复核');
  if (Array.isArray(aks?.analysis_claims)) for (const candidate of aks.analysis_claims) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.text !== 'string') continue;
    if (!['fact', 'contribution', 'hypothesis', 'limitation'].includes(String(candidate.kind))) continue;
    const evidence = Array.isArray(candidate.evidence_refs) ? candidate.evidence_refs.flatMap(ref => {
      if (!isRecord(ref) || typeof ref.label !== 'string') return [];
      return [{ label: ref.label, url: typeof ref.url === 'string' ? ref.url : undefined,
        type: typeof ref.type === 'string' ? ref.type : undefined, relation: typeof ref.relation === 'string' ? ref.relation : undefined,
        version: typeof ref.version === 'string' ? ref.version : undefined, coverage: typeof ref.coverage === 'string' ? ref.coverage : undefined,
        scope_hash: typeof ref.scope_hash === 'string' ? ref.scope_hash : undefined }];
    }) : [];
    claims[candidate.id] = { id: candidate.id, text: candidate.text, kind: candidate.kind as FinancialClaim['kind'],
      status: ['supported', 'refuted', 'unverified', 'unreviewable'].includes(String(candidate.status)) ? candidate.status as FinancialClaim['status'] : 'unverified',
      amount: typeof candidate.amount === 'number' || typeof candidate.amount === 'string' ? candidate.amount : undefined,
      currency: typeof candidate.currency === 'string' ? candidate.currency : undefined,
      evidence_refs: evidence as FinancialClaim['evidence_refs'] };
  }
  return { stages, claims, ...(plan ? {plan} : {}) };
}
const labels = { fact: '数据事实', contribution: '算术贡献（不等于因果）', hypothesis: '业务假设 · 待验证', limitation: '口径限制' };
const safeLink = (url?: string) => url && (/^https?:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'))) ? url : undefined;
export function FinancialAnalysisBlocks({ value }: { value: BusinessProgress }) {
  return <section aria-label="财务业务分析进展" aria-live="polite">
    {!!value.stages.length && <p>已发生的业务阶段：{value.stages.join(' → ')}（仅依据平台实际事件）</p>}
    {value.plan && <details><summary>专业分析计划与验证进展（{value.plan.steps.length} 项）</summary><ol>
      {value.plan.steps.map(step => <li key={step.id}><strong>{step.title}</strong> · {({pending: '待执行', evidence_received: '已收到依据，尚待复核', failed: '未完成', needs_review: '发现异常，待复核'} as Record<string, string>)[step.status] || '待确认'}
        {step.refutations.map((reason, index) => <p key={`refute:${index}`}>反证或异常：{reason}</p>)}
        {step.gaps.map((gap, index) => <p key={`gap:${index}`}>证据缺口：{gap}</p>)}
      </li>)}
    </ol></details>}
    {Object.values(value.claims).map(claim => <article className="panel" key={claim.id}>
      <h4>{labels[claim.kind]} · {{ supported: '证据支持', refuted: '存在反证', unverified: '待验证', unreviewable: '不可复核' }[claim.status || 'unverified']}</h4><p>{claim.text}</p>
      {claim.amount !== undefined && <p>金额影响：{claim.amount} {claim.currency || '单位待核验'}</p>}
      {!claim.evidence_refs?.length && claim.kind !== 'limitation' && <p role="note">缺少可核验依据：此解释待验证，不能作为确定根因。</p>}
      {!!claim.evidence_refs?.length && <details><summary>查看分析依据（{claim.evidence_refs.length}）</summary><ul>{claim.evidence_refs.map((ref, index) => <li key={`${index}:${ref.label}`}>
        {safeLink(ref.url) ? <a href={safeLink(ref.url)} target="_blank" rel="noopener noreferrer">{ref.label}</a> : ref.label}
        <span> · {ref.relation === 'refutes' ? '反证' : ref.relation === 'supports' ? '支持依据' : '背景参考'} · {ref.coverage === 'sample' ? '样本数据，不能外推总体' : ref.coverage === 'full_aggregate' ? '全量汇总' : ref.type === 'methodology' ? '方法依据，不证明财务事实' : '覆盖范围待核验'}{ref.version ? ` · 版本 ${ref.version}` : ''}</span>
        {ref.scope_hash && <details><summary>范围校验标识</summary><code>{ref.scope_hash}</code></details>}
      </li>)}</ul></details>}
    </article>)}
  </section>;
}
