import { expect, test } from '@playwright/test';
import { scopeValidation, requestScope, emptyScope, type ScopeCatalog } from '../src/FinancialScope';
import { businessProgress, initialBusinessProgress } from '../src/FinancialAnalysisBlocks';
import { analysisConfirmation } from '../src/AnalysisConfirmation';

const catalog: ScopeCatalog = { currency: 'CNY', periods: ['2026-01', '2026-03'], entities: ['A', 'B'], available_scopes: [{ entity: 'A', period: '2026-01' }, { entity: 'A', period: '2026-03' }, { entity: 'B', period: '2026-01' }] };
test('actual combinations and complete YTD are validated without fake zeros', () => {
  const value = { ...emptyScope(), period: '2026-03', entity: 'A' };
  expect(scopeValidation(catalog, value)).toEqual([]);
  expect(scopeValidation(catalog, { ...value, frequency: 'ytd' })).toContain('所选范围存在缺月或缺失主体，不可将缺失数据视为零或计算完整 YTD');
  expect(scopeValidation(catalog, { ...value, entity: 'B' })).not.toEqual([]);
  expect(scopeValidation(catalog, { ...value, basis: 'prior_year' })).not.toEqual([]);
});
test('budget limitations require acknowledgement and aggregate is never consolidated', () => {
  const value = { ...emptyScope(), period: '2026-01', entity: 'all', basis: 'budget' as const };
  expect(scopeValidation(catalog, value)).toContain('请确认预算版本或汇总口径限制');
  const confirmed = { ...value, acknowledged: true };
  expect(scopeValidation(catalog, confirmed)).toEqual([]);
  expect(requestScope(confirmed, 'CNY')).toMatchObject({ consolidation_mode: 'aggregate', assumptions: { budget_version_unverified: true, consolidation_eliminations_unavailable: true } });
});
test('business stages are driven by real events; same claim ID updates without duplication', () => {
  let state = initialBusinessProgress();
  state = businessProgress(state, { event: 'message_chunk', data: { content: '我准备核验数据' } });
  expect(state.stages).toEqual([]);
  const artifact = (text: string) => ({ event: 'agent_artifacts', data: { artifacts: { aksdata: { analysis_claims: [{ id: 'c1', kind: 'hypothesis', text, status: 'unverified', evidence_refs: [] }] } } } });
  state = businessProgress(state, artifact('可能受价格影响'));
  state = businessProgress(state, artifact('价格假设仍待明细验证'));
  expect(state.stages).toEqual(['差异解释']);
  expect(Object.values(state.claims)).toHaveLength(1);
  expect(state.claims.c1.text).toBe('价格假设仍待明细验证');
  expect(state.claims.c1.status).toBe('unverified');
});
test('confirmation contract unwraps nested interrupt values and rejects invalid revisions', () => {
  const request = { type: 'analysis_confirmation', revision: 'a'.repeat(64), title: '扩展', summary: '核对预算' };
  expect(analysisConfirmation({ interrupts: [{ value: request }] })).toEqual(request);
  expect(analysisConfirmation({ ...request, revision: 'missing' })).toBeUndefined();
  expect(analysisConfirmation({ type: 'other', revision: request.revision })).toBeUndefined();
});

test('business plan carries verification gaps through stream snapshots', () => {
  const plan = {status: 'needs_review', steps: [{id: 'v1', title: '现金勾稽复核', status: 'needs_review', gaps: ['缺少受限资金明细'], refutations: ['期末余额未勾平']}]};
  const state = businessProgress(initialBusinessProgress(), {event: 'orchestrator_stage', data: {analysis_plan: plan}});
  expect(state.plan).toEqual(plan);
  const restored = businessProgress(initialBusinessProgress(), {event: 'stream_snapshot', data: {latest: {analysis_plan: plan}}});
  expect(restored.plan?.steps[0].refutations).toEqual(['期末余额未勾平']);
});
