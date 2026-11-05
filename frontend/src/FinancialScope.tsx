import { useEffect, useState } from 'react';
import { platformRequest } from './platform';

export interface ScopeCatalog {
  currency: string; periods: string[]; entities: string[];
  available_scopes: { entity: string; period: string }[];
}
export interface ScopeChoice {
  scene: 'operating' | 'budget' | 'cash' | 'receivables';
  period: string; entity: string; basis: 'none' | 'prior_period' | 'prior_year' | 'budget';
  frequency: 'month' | 'ytd'; unit: 'ones' | 'ten_thousands' | 'millions'; acknowledged: boolean;
}
export const emptyScope = (): ScopeChoice => ({ scene: 'operating', period: '', entity: '', basis: 'none', frequency: 'month', unit: 'ten_thousands', acknowledged: false });

export function scopeValidation(catalog: ScopeCatalog | undefined, choice: ScopeChoice): string[] {
  if (!catalog || !choice.period || !choice.entity) return ['请选择数据源实际存在的主体和期间'];
  const entities = choice.entity === 'all' ? catalog.entities : [choice.entity];
  const end = Number(choice.period.slice(5));
  const periods = choice.frequency === 'ytd'
    ? Array.from({ length: end }, (_, index) => `${choice.period.slice(0, 4)}-${String(index + 1).padStart(2, '0')}`) : [choice.period];
  const exists = (period: string, entity: string) => catalog.available_scopes.some(row => row.period === period && row.entity === entity);
  const missing = periods.some(period => entities.some(entity => !exists(period, entity)));
  const issues = missing ? ['所选范围存在缺月或缺失主体，不可将缺失数据视为零或计算完整 YTD'] : [];
  if (choice.basis === 'prior_year' || choice.basis === 'prior_period') {
    const prior = periods.map(period => {
      const date = new Date(`${period}-01T00:00:00Z`);
      if (choice.basis === 'prior_year') date.setUTCFullYear(date.getUTCFullYear() - 1);
      else date.setUTCMonth(date.getUTCMonth() - 1);
      return date.toISOString().slice(0, 7);
    });
    if (prior.some(period => entities.some(entity => !exists(period, entity)))) issues.push('比较期间数据不完整，请更改比较基础；不会生成虚假增长率');
  }
  if (choice.frequency === 'ytd' && choice.basis === 'prior_period') issues.push('YTD 不支持月度环比，请选择同比或无比较');
  if ((choice.entity === 'all' || choice.basis === 'budget') && !choice.acknowledged) issues.push('请确认预算版本或汇总口径限制');
  return issues;
}

export function requestScope(choice: ScopeChoice, currency: string) {
  return {
    entities: choice.entity === 'all' ? [] : [choice.entity],
    period_start: choice.frequency === 'ytd' ? `${choice.period.slice(0, 4)}-01` : choice.period,
    period_end: choice.period, comparison_basis: choice.basis, currency, unit: choice.unit,
    consolidation_mode: choice.entity === 'all' ? 'aggregate' : 'single_entity',
    assumptions: { scene: choice.scene, frequency: choice.frequency,
      budget_version_unverified: choice.basis === 'budget', consolidation_eliminations_unavailable: choice.entity === 'all', limitations_acknowledged: choice.acknowledged },
  };
}

export function FinancialScope({ workspace, disabled, value, onChange, onCatalog }: {
  workspace: string; disabled: boolean; value: ScopeChoice; onChange: (value: ScopeChoice) => void;
  onCatalog: (catalog: ScopeCatalog | undefined) => void;
}) {
  const [catalog, setCatalog] = useState<ScopeCatalog>();
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setCatalog(undefined); onCatalog(undefined); setError('');
    if (!/^[1-9]\d*$/.test(workspace)) return;
    platformRequest<{ scope_catalog: ScopeCatalog }>(`/api/application-center/v1/workspaces/${workspace}/applications/finance/context`).then(context => {
      if (!current) return;
      const result = context.scope_catalog;
      if (!result) throw new Error('当前空间未提供财务分析范围');
      if (!Array.isArray(result.available_scopes) || !Array.isArray(result.entities) || !Array.isArray(result.periods)) throw new Error('财务数据范围返回格式无效');
      setCatalog(result); onCatalog(result);
    }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : '无法读取财务范围'); });
    return () => { current = false; };
  }, [workspace, onCatalog]);
  const update = (patch: Partial<ScopeChoice>) => onChange({ ...value, ...patch, acknowledged: false });
  const periods = catalog?.periods.filter(period => value.entity === 'all'
    ? catalog.entities.every(entity => catalog.available_scopes.some(row => row.period === period && row.entity === entity))
    : catalog.available_scopes.some(row => row.period === period && row.entity === value.entity)) || [];
  return <fieldset disabled={disabled}><legend>财务分析场景与口径</legend>
    {error && <p role="alert">{error}；财务数据分析暂停，知识问答仍可使用。</p>}
    <div className="platform-form">
      <label>财务场景<select value={value.scene} onChange={e => update({ scene: e.target.value as ScopeChoice['scene'], basis: e.target.value === 'budget' ? 'budget' : 'none' })}>
        <option value="operating">经营与盈利</option><option value="budget">预算执行</option><option value="cash">现金与流动性</option><option value="receivables">应收与回款风险</option>
      </select></label>
      <label>分析主体<select value={value.entity} onChange={e => update({ entity: e.target.value, period: '' })}><option value="">请选择实际主体</option>{catalog?.entities.map(entity => <option key={entity}>{entity}</option>)}{(catalog?.entities.length || 0) > 1 && <option value="all">全部主体简单汇总（非合并报表）</option>}</select></label>
      <label>分析期间<select value={value.period} onChange={e => update({ period: e.target.value })}><option value="">请选择实际期间</option>{periods.map(period => <option key={period}>{period}</option>)}</select></label>
      <label>期间口径<select value={value.frequency} onChange={e => update({ frequency: e.target.value as ScopeChoice['frequency'] })}><option value="month">单月</option><option value="ytd">年初至今 YTD（需完整月份）</option></select></label>
      <label>比较基础<select value={value.basis} onChange={e => update({ basis: e.target.value as ScopeChoice['basis'] })}><option value="none">无比较</option><option value="prior_year">同比</option><option value="prior_period">环比</option><option value="budget">预算差异</option></select></label>
      <label>金额单位<select value={value.unit} onChange={e => update({ unit: e.target.value as ScopeChoice['unit'] })}><option value="ones">元</option><option value="ten_thousands">万元</option><option value="millions">百万元</option></select></label>
    </div>
    {(value.entity === 'all' || value.basis === 'budget') && <label><input type="checkbox" checked={value.acknowledged} onChange={e => onChange({ ...value, acknowledged: e.target.checked })} />我确认：预算版本尚未核验；多主体仅作简单汇总，未做内部交易抵销，不能视为合并报表。</label>}
    {scopeValidation(catalog, value).map(issue => <p className="muted" key={issue}>{issue}</p>)}
  </fieldset>;
}
