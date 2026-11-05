import { useEffect, useRef, useState } from 'react';
import { platformRequest as api } from './platform';
import type { ScopeCatalog } from './FinancialScope';
import { availableOverviewPeriods } from './financialOverviewData';

type Run = { id: string; app_id: string; status: string; created_at: string; error?: string;
  parameters: { entity: string; period: string }; result?: { product_type: 'dashboard' | 'report'; title: string; artifact_id: number; artifact_status?: 'active' | 'archived'; replaced_by_artifact_id?: number; workflow_steps: string[]; refresh_mode?: string; render_engine?: string; interactive_url?: string } };
const labels: Record<string, string> = { queued: '等待执行', running: '后台运行中', completed: '已生成 · 待复核', failed: '运行失败' };

export function FinanceApplication({ workspace, revision, catalog, appId, topicId, appType, refreshMode, renderEngine, title }: {
  workspace: string; revision: string; catalog: ScopeCatalog; appId: string; topicId: string; appType: 'dashboard' | 'report'; refreshMode: 'live' | 'snapshot' | 'hybrid'; renderEngine: 'native_dashboard' | 'h5_report' | 'plotly_report'; title: string;
}) {
  const [entity, setEntity] = useState(catalog.entities[0] || '');
  const periods = availableOverviewPeriods(catalog, entity);
  const [period, setPeriod] = useState(periods.at(-1) || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [html, setHtml] = useState('');
  const [interactiveUrl, setInteractiveUrl] = useState('');
  const [upstream, setUpstream] = useState('');
  const [replacement, setReplacement] = useState('');
  const live = useRef(true);
  const key = useRef<{ params: string; value: string }>();
  const base = `/api/application-center/v1/workspaces/${workspace}/applications/finance`;
  useEffect(() => {
    live.current = true;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await api<{ items: Run[] }>(`${base}/runs`);
        if (active) { setAllRuns(result.items); setRuns(result.items.filter(run => run.app_id === appId)); }
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : '运行记录读取失败'); }
      if (active) timer = setTimeout(refresh, 2000);
    }
    void refresh();
    return () => { live.current = false; active = false; clearTimeout(timer); };
  }, [base, appId]);
  async function run() {
    if (busy) return;
    setBusy(true); setError(''); setHtml(''); setInteractiveUrl('');
    const params = JSON.stringify({ period, entity, context_revision: revision,
      ...(upstream ? { upstream_dashboard_artifact_id: Number(upstream) } : {}),
      ...(replacement ? { replace_report_artifact_id: Number(replacement) } : {}) });
    if (key.current?.params !== params) key.current = { params, value: crypto.randomUUID() };
    try {
      const result = await api<Run>(`${base}/apps/${appId}/runs`, { ...JSON.parse(params), idempotency_key: key.current.value });
      if (live.current) { setRuns(old => [result, ...old.filter(item => item.id !== result.id)]); key.current = undefined; }
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : '运行提交失败'); }
    finally { if (live.current) setBusy(false); }
  }
  async function preview(id: string, refresh = false) {
    setError(''); setHtml(''); setInteractiveUrl('');
    try {
      if (appType === 'dashboard') {
        const result = await api<{ dashboard_html: string }>(`${base}/runs/${id}/dashboard${refresh ? '/refresh' : ''}`, refresh ? {} : undefined, refresh ? 'POST' : 'GET');
        if (live.current) setHtml(result.dashboard_html);
      } else {
        const selected = runs.find(item => item.id === id);
        if (selected?.result?.interactive_url) {
          if (live.current) setInteractiveUrl(selected.result.interactive_url);
          return;
        }
        const result = await api<{ document_html: string }>(`${base}/runs/${id}/document`);
        if (live.current) setHtml(result.document_html);
      }
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : '成果读取失败'); }
  }
  async function refreshReport(id: string) {
    if (busy) return;
    setBusy(true); setError(''); setHtml(''); setInteractiveUrl('');
    try {
      const result = await api<Run>(`${base}/runs/${id}/report/refresh`, {}, 'POST');
      if (live.current) setRuns(old => [result, ...old.filter(item => item.id !== result.id)]);
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : '报告刷新失败'); }
    finally { if (live.current) setBusy(false); }
  }
  async function previewFrozenReport(id: string) {
    setError(''); setHtml(''); setInteractiveUrl('');
    try {
      const result = await api<{ document_html: string }>(`${base}/runs/${id}/document`);
      if (live.current) setHtml(result.document_html);
    } catch (reason) { if (live.current) setError(reason instanceof Error ? reason.message : '冻结报告读取失败'); }
  }
  const dashboardRuns = allRuns.filter(run => run.app_id === `${topicId}-dashboard` && run.status === 'completed'
    && run.parameters.entity === entity && run.parameters.period === period && run.result);
  const reportRuns = allRuns.filter(run => run.app_id === topicId && run.status === 'completed' && run.result?.artifact_status !== 'archived').slice(0, 1);
  return <section aria-label="财务应用运行">
    <div className="v2-intro"><h2>{title}</h2><p>{appType === 'dashboard'
      ? '动态看板保存分析口径与组件配置，可随当前空间数据主动刷新并复用。'
      : refreshMode === 'hybrid' && renderEngine === 'plotly_report'
        ? '交互报告使用 Plotly 探索财务结构；每次刷新都会生成新的冻结版本，旧版保留在审计链路中。'
        : '报告固定引用一次看板数据快照与知识依据，生成后保持静态；重新生成将形成可追溯的新版本。'}</p></div>
    <div className="overview-filters"><label>核算主体<select aria-label="应用核算主体" value={entity} onChange={event => {
      const next = event.target.value; setEntity(next);
      const available = availableOverviewPeriods(catalog, next); if (!available.includes(period)) setPeriod(available.at(-1) || '');
    }}>{catalog.entities.map(name => <option key={name}>{name}</option>)}{availableOverviewPeriods(catalog, 'all').length > 0 && <option value="all">全部主体简单汇总（非合并）</option>}</select></label>
      <label>会计期间<select aria-label="应用会计期间" value={period} onChange={event => setPeriod(event.target.value)}>{periods.map(value => <option key={value}>{value}</option>)}</select></label>
      {appType === 'report' && <label>前置看板（可选）<select aria-label="报告前置看板" value={upstream} onChange={event => setUpstream(event.target.value)}><option value="">运行时生成快照</option>{dashboardRuns.map(item => <option key={item.id} value={item.result!.artifact_id}>{item.result!.title} · #{item.result!.artifact_id}</option>)}</select></label>}
      {appType === 'report' && <label>替换已有报告（可选）<select aria-label="替换已有报告" value={replacement} onChange={event => setReplacement(event.target.value)}><option value="">生成独立报告</option>{reportRuns.map(item => <option key={item.id} value={item.result!.artifact_id}>{item.result!.title} · #{item.result!.artifact_id}</option>)}</select></label>}
      <button className="primary" disabled={busy || !period || runs.some(r => ['queued', 'running'].includes(r.status) && r.parameters.entity === entity && r.parameters.period === period)} onClick={run}>{busy ? '正在启动…' : '运行应用'}</button>
    </div>
    <p className="v2-note">生成结果为内部分析草稿，缺失制度或数据会明确标注；不会自动确认预算版本、发布报告或认定经营根因。</p>
    {error && <p role="alert" className="v2-error">{error}</p>}
    <h3>最近运行</h3>
    {!runs.length && <p className="v2-note">暂无运行记录</p>}
    {runs.map(item => <article className="v2-card" key={item.id}><strong>{item.parameters.period} · {item.parameters.entity === 'all' ? '全部主体简单汇总' : item.parameters.entity}</strong><p>{labels[item.status] || item.status} · {new Date(item.created_at).toLocaleString()}</p>
      {item.error && <p role="alert">{item.error}</p>}
      {item.result && <><p>{item.result.artifact_status === 'archived' ? `已由成果 #${item.result.replaced_by_artifact_id} 替换` : `已登记底座${item.result.product_type === 'dashboard' ? '看板' : '报告'}成果 #${item.result.artifact_id}`}</p>{item.result.artifact_status !== 'archived' && <button className="secondary" onClick={() => preview(item.id)}>{appType === 'dashboard' ? '查看动态看板' : item.result.interactive_url ? '查看 Plotly 交互报告' : '查看 H5 报告'}</button>}{appType === 'dashboard' && item.result.artifact_status !== 'archived' && <button className="secondary" onClick={() => preview(item.id, true)}>刷新数据</button>}{appType === 'report' && refreshMode === 'hybrid' && item.result.artifact_status !== 'archived' && <button className="secondary" disabled={busy} onClick={() => refreshReport(item.id)}>刷新并生成新版本</button>}{appType === 'report' && item.result.artifact_status !== 'archived' && item.result.interactive_url && <button className="secondary" onClick={() => previewFrozenReport(item.id)}>查看冻结 H5</button>}</>}
    </article>)}
    {html && <iframe title={appType === 'dashboard' ? '财务动态看板' : '财务应用 H5 报告'} sandbox="" srcDoc={html} style={{ width: '100%', height: '80vh', border: '1px solid #dfe7e8', marginTop: 20 }} />}
    {interactiveUrl && <iframe title="财务 Plotly 交互报告" src={interactiveUrl} style={{ width: '100%', height: '80vh', border: '1px solid #dfe7e8', marginTop: 20 }} />}
  </section>;
}
