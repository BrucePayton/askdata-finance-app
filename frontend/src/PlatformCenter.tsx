import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Send, Share2, Sparkles, Square, RotateCcw, LayoutDashboard, FileText, WandSparkles, Play, MessageSquareText } from 'lucide-react';
import { analysisReducer, initialAnalysisState } from './shared/analysis-room/reducer';
import { ResultTable } from './shared/analysis-room/ResultTable';
import { platformRequest as api, platformToken, streamAnalysis, replayAnalysis, savedAnalysis, getAnalysisRun, cancelAnalysisRun, type AnalysisRun, type StreamEvent } from './platform';
import { ClarificationForm, type Clarification } from './ClarificationForm';
import { RichText } from './RichText';
import { ReportReview } from './ReportReview';
import { FinancialScope, emptyScope, requestScope, scopeValidation, type ScopeCatalog, type ScopeChoice } from './FinancialScope';
import { FinancialAnalysisBlocks, initialBusinessProgress, businessProgress } from './FinancialAnalysisBlocks';
import { AnalysisConfirmation, analysisConfirmation } from './AnalysisConfirmation';
import './platform.css';

type ArtifactRef = { preview_url?: string; platform_deep_link: string };
type Artifact = { id: number | string; title: string; artifact_type: string; canonical_question?: string; created_at?: string; payload_ref?: Record<string, unknown>; artifact_ref?: ArtifactRef };
type SessionResult = {
  generated_sql?: string;
  data_table?: { columns: string[]; rows: Record<string, unknown>[] };
  report_card?: { url: string; title: string; html_artifact_id: number; production_artifact_id?: number; registration_status?: string };
  dashboard_card?: { url: string; title?: string; scene_id?: string; publish_verified?: boolean; publish_status?: string };
};
type Tab = 'analysis' | 'artifacts';
export type FinanceRoomApp = { app_id: string; app_type: 'dashboard' | 'report'; name: string; category: string; business_question: string; refresh_mode: 'live' | 'snapshot' | 'hybrid' };
type CustomFinanceApp = Artifact & { payload_ref?: { prompt?: string; deliverable?: 'dashboard' | 'report'; analysis_brief?: string; domain_codes?: string[] } };
type FixedRun = { id: string; app_id: string; status: string; error?: string; result?: { product_type: 'dashboard' | 'report'; title: string; artifact_id: number } };

function artifactUrl(artifact: Artifact): string | undefined {
  if (artifact.artifact_type === 'report' && artifact.payload_ref?.review_snapshot_hash) return;
  const ref = artifact.payload_ref || {};
  const candidate = artifact.artifact_ref?.preview_url || [ref.url, ref.preview_url, ref.public_url, ref.report_url, ref.dashboard_url, ref.dash_url, ref.iframe_url].find(value => typeof value === 'string');
  if (typeof candidate !== 'string') return;
  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin === window.location.origin && /^\/(dash|report|api\/v1\/reports)\//.test(url.pathname)) return url.href;
  } catch { /* Invalid references are never executed. */ }
}

function interruptMessage(value: Record<string, unknown>): string {
  for (const key of ['message', 'content', 'reason', 'question']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '分析需要确认业务口径后才能继续。';
}

const goalLabel: Record<string, string> = {
  data_analysis: '财务经营分析', knowledge_qa: '财务知识问答', dashboard: '生成动态看板', report: '生成 H5 报告',
};

export function PlatformCenter({ visible, initialTab = 'analysis', question = '', initialGoal = 'data_analysis', workspaceId = '', initialScene, apps = [], contextRevision = '', initialAppId = '', onReuse }: {
  visible: boolean; initialTab?: Tab; question?: string; initialGoal?: string; workspaceId?: string; initialScene?: ScopeChoice['scene']; apps?: FinanceRoomApp[]; contextRevision?: string; initialAppId?: string; onReuse?: (question: string) => void;
}) {
  const workspace = workspaceId;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [query, setQuery] = useState(question), [goal, setGoal] = useState(initialGoal);
  const [answer, setAnswer] = useState(''), [thread, setThread] = useState(''), [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState('idle');
  const [restoredContext, setRestoredContext] = useState<AnalysisRun['context']>();
  const [scopeChoice, setScopeChoice] = useState(() => ({ ...emptyScope(), ...(initialScene ? { scene: initialScene, basis: initialScene === 'budget' ? 'budget' as const : 'none' as const } : {}) }));
  const [scopeCatalog, setScopeCatalog] = useState<ScopeCatalog>();
  const [progress, setProgress] = useState(initialBusinessProgress);
  const [generationConfirmed, setGenerationConfirmed] = useState(false);
  const [userMessages, setUserMessages] = useState<string[]>([]);
  const [assistantMessages, setAssistantMessages] = useState<string[]>([]);
  const [interrupt, setInterrupt] = useState<Record<string, unknown>>();
  const [clarification, setClarification] = useState('');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactPage, setArtifactPage] = useState(1), [artifactTotal, setArtifactTotal] = useState(0);
  const [artifactType, setArtifactType] = useState(''), [artifactScope, setArtifactScope] = useState('finance');
  const [sessionResult, setSessionResult] = useState<SessionResult>({});
  const [savedArtifact, setSavedArtifact] = useState<{ id: number; workspace_id: number }>();
  const [roomMode, setRoomMode] = useState<'ask' | 'create' | 'use'>(initialAppId ? 'use' : 'ask');
  const [customApps, setCustomApps] = useState<CustomFinanceApp[]>([]);
  const [selectedApp, setSelectedApp] = useState(initialAppId ? `fixed:${initialAppId}` : '');
  const [applicationTitle, setApplicationTitle] = useState('');
  const [applicationDeliverable, setApplicationDeliverable] = useState<'dashboard' | 'report'>('dashboard');
  const [invokedRun, setInvokedRun] = useState<FixedRun>();
  const [appPreview, setAppPreview] = useState('');
  const [reviewArtifact, setReviewArtifact] = useState<Artifact>();
  const [shareArtifact, setShareArtifact] = useState<Artifact>();
  const [shareConfirmed, setShareConfirmed] = useState(false), [shareHours, setShareHours] = useState('24'), [shareUrl, setShareUrl] = useState('');
  const artifactPageSize = 12;
  const abort = useRef<AbortController>();
  const analysisState = useRef(initialAnalysisState());

  useEffect(() => { if (visible) setTab(initialTab); }, [initialTab, visible]);
  useEffect(() => { if (question) { setQuery(question); setGoal(initialGoal); } }, [question, initialGoal]);
  useEffect(() => () => abort.current?.abort(), []);

  function clearSession() {
    setInterrupt(undefined); setThread(''); setAnswer(''); setSessionResult({}); setClarification(''); setSavedArtifact(undefined);
    setRunStatus('idle'); setRestoredContext(undefined); setProgress(initialBusinessProgress()); setGenerationConfirmed(false); setUserMessages([]); setAssistantMessages([]); setQuery('');
  }
  async function run(task: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await task(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function refreshWorkspace(page = artifactPage, type = artifactType) {
    if (!workspace) { setArtifacts([]); setArtifactTotal(0); return; }
    const params = new URLSearchParams({ workspace_id: workspace, status: 'active', page: String(page), page_size: String(artifactPageSize), domain_code: 'function.finance' });
    if (artifactScope === 'all') params.delete('domain_code');
    if (type) params.set('artifact_type', type);
    const result = await api<{ items: Artifact[]; total: number }>(`/api/askdata/production-artifacts?${params}`);
    setArtifacts(result.items || []); setArtifactTotal(result.total || 0);
  }
  async function refreshCustomApplications() {
    if (!workspace) { setCustomApps([]); return; }
    const params = new URLSearchParams({ workspace_id: workspace, status: 'active', page: '1', page_size: '100', artifact_type: 'finance_application', domain_code: 'function.finance' });
    const result = await api<{ items: CustomFinanceApp[] }>(`/api/askdata/production-artifacts?${params}`);
    setCustomApps(result.items || []);
  }
  function reuseArtifact(artifact: Artifact) {
    const prompt = typeof artifact.payload_ref?.prompt === 'string' ? artifact.payload_ref.prompt : artifact.canonical_question;
    onReuse?.(prompt || `请基于“${artifact.title}”继续开展财务分析，核验当前空间最新数据，并说明指标变化、经营影响和建议。`);
  }
  async function createShare() {
    if (!shareArtifact || !shareConfirmed) return;
    await run(async () => {
      const result = await api<{ share_path: string }>(`/api/askdata/production-artifacts/${shareArtifact.id}/shares`, { workspace_id: Number(workspace), expires_hours: Number(shareHours), confirm_external: true });
      const url = new URL(result.share_path, window.location.origin).href;
      setShareUrl(url);
      try { await navigator.clipboard.writeText(url); setNotice('只读快照链接已创建并复制。'); } catch { setNotice('只读快照链接已创建，请手动复制。'); }
    });
  }
  useEffect(() => {
    if (platformToken()) void run(async () => { await Promise.all([refreshWorkspace(artifactPage, artifactType), refreshCustomApplications()]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, artifactPage, artifactType, artifactScope]);

  useEffect(() => {
    if (!invokedRun || !['queued', 'running'].includes(invokedRun.status)) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const next = await api<FixedRun>(`/api/application-center/v1/workspaces/${workspace}/applications/finance/runs/${invokedRun.id}`);
        if (active) setInvokedRun(next);
      } catch (reason) { if (active) setError((reason as Error).message); }
    }, 1800);
    return () => { active = false; window.clearTimeout(timer); };
  }, [invokedRun, workspace]);

  function acceptResult(event: StreamEvent) {
    analysisState.current = analysisReducer(analysisState.current, event);
    setAnswer(Object.values(analysisState.current.messages).join('\n\n'));
    setSessionResult((analysisState.current.artifacts.aksdata || {}) as SessionResult);
    setInterrupt(analysisState.current.interrupt);
    setRunStatus(analysisState.current.status);
    setProgress(current => businessProgress(current, event));
  }

  async function analyze(options: { feedback?: string; structured?: Record<string, unknown>; followup?: boolean; confirmation?: { revision: string; decision: 'approve' | 'reject' } } = {}) {
    const { feedback, structured, followup = false, confirmation } = options;
    const message = query.trim();
    if (!workspace || (!message && !feedback && !structured && !confirmation) || running) return;
    const resume = !!feedback || !!structured || followup || !!confirmation;
    if (!resume && goal !== 'knowledge_qa' && scopeValidation(scopeCatalog, scopeChoice).length) { setError('请先完成实际主体、期间及比较口径确认'); return; }
    if (!confirmation && ['report', 'dashboard'].includes(goal) && !generationConfirmed) { setError('请确认报告/看板生成的执行成本；本操作不会自动发布'); return; }
    const id = resume ? thread : crypto.randomUUID();
    if (!resume) {
      analysisState.current = initialAnalysisState(); setAnswer(''); setSessionResult({}); setProgress(initialBusinessProgress());
      setUserMessages([message]); setAssistantMessages([]);
    } else if (followup) {
      setUserMessages(items => [...items, message]); setAssistantMessages(items => [...items, answer]);
      analysisState.current = { ...analysisState.current, messages: {} }; setAnswer('');
    }
    setThread(id); setRunning(true); setRunStatus('running'); setError(''); setInterrupt(undefined);
    const controller = new AbortController(); abort.current = controller;
    try {
      await streamAnalysis({
        thread_id: id, workspace_id: Number(workspace), application_context: { application_id: 'finance' },
        messages: followup ? [{ role: 'user', content: message }] : resume ? [] : [{ role: 'user', content: message }],
        locale: 'zh-CN', enable_web_search: false, auto_accepted_plan: false, session_outcome_goals: [goal], report_style: 'industry_report',
        ...(resume && restoredContext?.analysis_scope ? { analysis_scope: restoredContext.analysis_scope } : scopeCatalog && scopeChoice.period && scopeChoice.entity ? { analysis_scope: requestScope(scopeChoice, scopeCatalog.currency) } : {}),
        ...(structured ? { clarification_submit: structured } : {}),
        ...(confirmation ? { analysis_confirmation: confirmation } : {}),
        ...(feedback ? { interrupt_feedback: feedback, askdata_hitl_visualize_confirmed: goal === 'dashboard', askdata_hitl_report_confirmed: goal === 'report' } : {}),
      }, controller.signal, ({ event, data }) => {
        acceptResult({ event, data });
        if (typeof data.thread_id === 'string') setThread(data.thread_id);
        if (event === 'interrupt') { setInterrupt(data); setClarification(''); }
        if (event === 'stream_terminal' && data.status === 'budget_exceeded') throw new Error('本次分析已达到执行预算上限；已有结果已保留，未完成部分不能视为成功。');
        if (event === 'stream_terminal' && ['failed', 'interrupted', 'history_required'].includes(String(data.status))) throw new Error(String(data.message || '分析执行已中断，请核对已有成果'));
        if (event === 'error' || event === 'askdata_error') throw new Error(String(data.message || data.content || data.error || '智能分析服务错误'));
      });
      await refreshWorkspace();
      setQuery('');
    } catch (reason) {
      setError(controller.signal.aborted ? '已停止接收；平台可能仍在处理，请稍后恢复结果或查看分析记录。' : (reason as Error).message);
    } finally { setRunning(false); }
  }

  async function recoverAnalysis() {
    const saved = savedAnalysis(workspace);
    if (!saved || running) return;
    analysisState.current = initialAnalysisState(); clearSession(); setThread(saved.threadId); setRunning(true); setError('');
    const controller = new AbortController(); abort.current = controller;
    try {
      const metadata = await getAnalysisRun(saved.runId);
      setRestoredContext(metadata.context); setRunStatus(metadata.status);
      if (metadata.context?.query) setUserMessages([metadata.context.query]);
      if (metadata.context?.session_outcome_goals?.[0]) setGoal(metadata.context.session_outcome_goals[0]);
      await replayAnalysis(saved.runId, controller.signal, ({ event, data }) => {
        acceptResult({ event, data });
        if (event === 'interrupt') setInterrupt(data);
        if (event === 'stream_terminal' && data.status === 'budget_exceeded') throw new Error('历史分析已达到执行预算上限，已恢复的是部分结果。');
        if ((event === 'stream_terminal' && ['failed', 'interrupted', 'history_required'].includes(String(data.status))) || event === 'askdata_error') throw new Error(String(data.message || '分析执行已中断，已恢复先前结果'));
      });
      await refreshWorkspace();
    } catch (reason) { setError((reason as Error).message); } finally { setRunning(false); }
  }

  async function requestCancellation() {
    const saved = savedAnalysis(workspace);
    if (!saved || saved.threadId !== thread) throw new Error('尚未取得当前分析执行标识，请稍后重试');
    const result = await cancelAnalysisRun(saved.runId);
    setRunStatus(current => ['cancelled', 'completed', 'failed', 'interrupted'].includes(current) ? current : result.status);
    setNotice(result.status === 'cancel_requested' ? '取消请求已记录，当前步骤安全结束后不会继续分析。' : result.status === 'cancelled' ? '平台已确认分析取消。' : '任务已结束，无需再次取消。');
  }

  function changeScope(value: ScopeChoice) {
    setScopeChoice(value);
    if (thread || answer) {
      clearSession(); analysisState.current = initialAnalysisState();
      setNotice('业务范围已改变：下一次提问将创建新会话，历史成果不会被修改。');
    }
  }

  function chooseMode(mode: 'ask' | 'create' | 'use') {
    clearSession(); setRoomMode(mode); setInvokedRun(undefined); setAppPreview('');
    if (mode === 'create') {
      setGoal('data_analysis');
      setQuery('请根据当前空间真实数据与财务知识，帮我设计一个可重复使用的财务智能分析应用。请先明确业务目标、适用主体与期间、核心指标、分析步骤、看板组件、报告章节、所需知识依据和数据缺口。');
    }
  }

  function loadSelectedApplication() {
    if (!selectedApp) return;
    const [kind, id] = selectedApp.split(':', 2);
    if (kind === 'fixed') {
      const app = apps.find(item => item.app_id === id);
      if (!app) return;
      setGoal(app.app_type); setGenerationConfirmed(false); setRoomMode('ask');
      setQuery(`调用“${app.name}”，围绕以下业务目标开展分析：${app.business_question}。使用当前已确认的主体、期间与比较口径，形成${app.app_type === 'dashboard' ? '可刷新财务看板' : '专业 H5 财务报告'}，并说明财务结果对销售、采购、费用、库存或回款环节的影响。`);
    } else {
      const app = customApps.find(item => String(item.id) === id);
      const prompt = typeof app?.payload_ref?.prompt === 'string' ? app.payload_ref.prompt : '';
      const deliverable = app?.payload_ref?.deliverable === 'report' ? 'report' : 'dashboard';
      if (!prompt) { setError('该应用缺少可执行的分析问题，请重新生成应用'); return; }
      setGoal(deliverable); setGenerationConfirmed(false); setRoomMode('ask'); setQuery(prompt);
    }
  }

  async function invokeFixedApplication() {
    const [kind, id] = selectedApp.split(':', 2);
    const app = kind === 'fixed' ? apps.find(item => item.app_id === id) : undefined;
    if (!app) { setError('请选择平台内置的财务分析应用'); return; }
    const issues = scopeValidation(scopeCatalog, scopeChoice);
    if (issues.length) { setError(issues[0]); return; }
    await run(async () => {
      setAppPreview('');
      const result = await api<FixedRun>(`/api/application-center/v1/workspaces/${workspace}/applications/finance/apps/${app.app_id}/runs`, {
        period: scopeChoice.period, entity: scopeChoice.entity, context_revision: contextRevision,
        idempotency_key: `room-${app.app_id}-${crypto.randomUUID()}`,
      });
      setInvokedRun(result); setNotice(`${app.name}已进入后台运行，可留在分析室继续查看进度。`);
    });
  }

  async function previewInvokedApplication() {
    if (!invokedRun?.result) return;
    await run(async () => {
      const suffix = invokedRun.result!.product_type === 'dashboard' ? 'dashboard' : 'document';
      const result = await api<{ dashboard_html?: string; document_html?: string }>(`/api/application-center/v1/workspaces/${workspace}/applications/finance/runs/${invokedRun.id}/${suffix}`);
      setAppPreview(result.dashboard_html || result.document_html || '');
    });
  }

  async function saveAsFinanceApplication() {
    const prompt = userMessages[0]?.trim();
    if (!applicationTitle.trim() || !prompt || !answer.trim()) { setError('请先完成应用设计问答并填写应用名称'); return; }
    await run(async () => {
      const saved = await api<{ id: number; workspace_id: number }>('/api/askdata/production-artifacts', {
        workspace_id: Number(workspace), title: applicationTitle.trim(), canonical_question: prompt,
        artifact_type: 'finance_application', source_session_id: thread,
        payload_ref: {
          schema_version: 'finance-application-blueprint/v1', prompt, analysis_brief: answer,
          deliverable: applicationDeliverable,
          analysis_scope: scopeCatalog && scopeChoice.period && scopeChoice.entity ? requestScope(scopeChoice, scopeCatalog.currency) : undefined,
          domain_codes: ['function.finance'], generated_from: 'finance_analysis_room',
        },
      });
      if (!saved.id) throw new Error('平台未返回应用成果 ID，不能确认保存成功');
      await refreshCustomApplications(); setApplicationTitle('');
      setNotice(`新的财务智能分析应用已保存到当前空间 · 应用 #${saved.id}`);
    });
  }

  if (!platformToken()) return <section className="platform-center panel" style={visible ? undefined : { display: 'none' }}><div role="alert" className="platform-error">登录状态已失效，请返回财务应用中心重新登录。</div></section>;

  if (tab === 'artifacts') return <section className="platform-center panel finance-records" style={visible ? undefined : { display: 'none' }}>
    {error && <div role="alert" className="platform-error">{error}</div>}{notice && <div role="status" className="platform-notice">{notice}</div>}
    <div className="records-hero"><div><span className="v2-eyebrow">DELIVER · REVIEW · REUSE</span><h2>财务分析成果中心</h2><p>集中使用当前空间已形成的看板、报告和分析应用，无需跳转到底座成果页。</p></div><div><strong>{artifactTotal}</strong><small>当前筛选成果</small></div></div>
    <div className="records-flow"><span><LayoutDashboard />动态看板<small>刷新经营数据</small></span><b>→</b><span><FileText />专业报告<small>复核与定稿</small></span><b>→</b><span><Share2 />只读分享<small>限时快照</small></span></div>
    <div className="platform-toolbar"><label>成果范围<select value={artifactScope} onChange={event => { setArtifactPage(1); setArtifactScope(event.target.value); }}><option value="finance">财务领域成果</option><option value="all">空间全部成果</option></select></label><label>成果类型<select aria-label="成果类型" value={artifactType} onChange={event => { setArtifactPage(1); setArtifactType(event.target.value); }}><option value="">全部成果</option><option value="finance_application">财务智能分析应用</option><option value="report">H5 报告</option><option value="dashboard">动态看板</option><option value="sql_snippet">分析依据</option></select></label><button className="secondary" disabled={busy} onClick={() => void run(() => refreshWorkspace())}>刷新成果</button></div>
    {!artifacts.length && <div className="records-empty"><FileText /><h3>当前范围尚无已登记成果</h3><p>系统不会用浏览器草稿或模拟记录替代。可前往智能分析入口生成看板、报告或应用。</p>{onReuse && <button className="primary" onClick={() => onReuse('请基于当前空间真实数据，建议一个最值得优先建设的财务经营看板或报告，并说明理由。')}>去智能分析室生成</button>}</div>}
    <div className="artifact-grid">{artifacts.map(artifact => { const url = artifactUrl(artifact); const shareable = ['dashboard', 'report'].includes(artifact.artifact_type); return <article className="artifact-card" key={artifact.id}><div className="artifact-kind">{artifact.artifact_type === 'dashboard' ? <LayoutDashboard /> : <FileText />}<span>{artifact.artifact_type === 'dashboard' ? '动态看板' : artifact.artifact_type === 'report' ? 'H5 报告' : artifact.artifact_type === 'finance_application' ? '分析应用' : '分析依据'}</span></div><h3>{artifact.title}</h3><p>{artifact.canonical_question || (artifact.artifact_type === 'dashboard' ? '可刷新并复用的经营监控成果' : artifact.artifact_type === 'report' ? '可复核、可定稿的专业财务报告' : '可在分析室重新调用')}</p><small>成果 #{artifact.id}{artifact.created_at ? ` · ${new Date(artifact.created_at).toLocaleDateString('zh-CN')}` : ''}</small><div className="artifact-actions">{url && <a className="primary" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />打开成果</a>}{artifact.artifact_type === 'report' && <button className="secondary" onClick={() => setReviewArtifact(current => current?.id === artifact.id ? undefined : artifact)}>{reviewArtifact?.id === artifact.id ? '收起复核' : '专业复核'}</button>}{shareable && <button className="secondary" onClick={() => { setShareArtifact(artifact); setShareConfirmed(false); setShareUrl(''); }}>分享快照</button>}{onReuse && <button className="secondary" onClick={() => reuseArtifact(artifact)}>在分析室复用</button>}</div>{reviewArtifact?.id === artifact.id && <ReportReview id={artifact.id} workspace={workspace} payload={artifact.payload_ref || {}} onChange={() => refreshWorkspace()} />}</article>; })}</div>
    {shareArtifact && <section className="share-panel" aria-label="成果分享"><button className="share-close" aria-label="关闭分享" onClick={() => setShareArtifact(undefined)}>×</button><span className="v2-eyebrow">只读快照分享</span><h3>{shareArtifact.title}</h3><p>外链是当前成果的冻结快照，不会随源数据刷新；原成果变更或撤销分享后链接失效。</p><label>分享有效期<select aria-label="分享有效期" value={shareHours} onChange={event => setShareHours(event.target.value)}><option value="1">1 小时</option><option value="24">24 小时</option><option value="72">3 天</option><option value="168">7 天</option></select></label><label className="share-consent"><input type="checkbox" checked={shareConfirmed} onChange={event => setShareConfirmed(event.target.checked)} />我确认快照可供持有链接的外部人员阅读</label><button className="primary" disabled={busy || !shareConfirmed} onClick={() => void createShare()}><Copy size={15} />生成并复制外链</button>{shareUrl && <label>外部分享链接<input aria-label="外部分享链接" readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} /></label>}</section>}
    {artifactTotal > artifactPageSize && <nav className="platform-toolbar" aria-label="成果分页"><button className="secondary" disabled={busy || artifactPage <= 1} onClick={() => setArtifactPage(page => Math.max(1, page - 1))}>上一页</button><span>第 {artifactPage} / {Math.ceil(artifactTotal / artifactPageSize)} 页 · 共 {artifactTotal} 项</span><button className="secondary" disabled={busy || artifactPage * artifactPageSize >= artifactTotal} onClick={() => setArtifactPage(page => page + 1)}>下一页</button></nav>}
  </section>;

  const confirmation = analysisConfirmation(interrupt);
  const clarificationQuestions = (interrupt?.clarification as Clarification | undefined)?.questions;
  return <section className="finance-chat" aria-label="智能财务分析对话" style={visible ? undefined : { display: 'none' }}>
    <header className="finance-chat-header"><div className="finance-advisor"><Sparkles size={20} /><div><strong>衡策财务分析师</strong><small>使用当前空间的数据、知识与专业分析资产</small></div></div><div className="finance-chat-actions">{savedAnalysis(workspace) && <button className="secondary" disabled={running || busy} onClick={() => void recoverAnalysis()}><RotateCcw size={15} />恢复上次分析</button>}<button className="secondary" disabled={running} onClick={clearSession}>新对话</button></div></header>
    {error && <div role="alert" className="platform-error">{error}</div>}{notice && <div role="status" className="platform-notice">{notice}</div>}
    <section className="finance-entry-modes" aria-label="分析室入口方式"><button className={roomMode === 'ask' ? 'active' : ''} onClick={() => chooseMode('ask')}><MessageSquareText /><span><strong>直接问财务问题</strong><small>问数、归因与专业解释</small></span></button><button className={roomMode === 'create' ? 'active' : ''} onClick={() => chooseMode('create')}><WandSparkles /><span><strong>生成新的分析应用</strong><small>通过问答沉淀可复用应用</small></span></button><button className={roomMode === 'use' ? 'active' : ''} onClick={() => chooseMode('use')}><Play /><span><strong>调用已有应用</strong><small>生成动态看板或专业报告</small></span></button></section>
    {roomMode === 'use' && <section className="application-launcher" aria-label="调用已有财务应用"><div><span className="v2-eyebrow">当前空间应用库</span><h3>选择一个应用开始工作</h3><p>固定应用走稳定后台链路；由问答生成的应用会重新载入分析室，并沿用保存的业务目标。</p></div><label>财务智能分析应用<select aria-label="财务智能分析应用" value={selectedApp} onChange={event => { setSelectedApp(event.target.value); setInvokedRun(undefined); setAppPreview(''); }}><option value="">请选择应用</option><optgroup label="平台内置应用">{apps.map(item => <option key={item.app_id} value={`fixed:${item.app_id}`}>{item.app_type === 'dashboard' ? '看板' : '报告'} · {item.name}</option>)}</optgroup>{customApps.length > 0 && <optgroup label="问答生成的应用">{customApps.map(item => <option key={item.id} value={`custom:${item.id}`}>{item.payload_ref?.deliverable === 'report' ? '报告' : '看板'} · {item.title}</option>)}</optgroup>}</select></label><div className="launcher-actions"><button className="secondary" disabled={!selectedApp} onClick={loadSelectedApplication}>载入对话调整后执行</button><button className="primary" disabled={!selectedApp.startsWith('fixed:') || !contextRevision || busy || running} onClick={() => void invokeFixedApplication()}>直接运行固定应用</button></div>
      {invokedRun && <article className="invoked-run" aria-live="polite"><div>{invokedRun.result?.product_type === 'dashboard' ? <LayoutDashboard /> : <FileText />}<span><strong>{apps.find(item => item.app_id === invokedRun.app_id)?.name || '财务分析应用'}</strong><small>{({ queued: '等待后台执行', running: '正在读取数据并生成成果', completed: '已生成并登记成果', failed: '生成失败' } as Record<string, string>)[invokedRun.status] || invokedRun.status}</small></span></div>{invokedRun.error && <p role="alert">{invokedRun.error}</p>}{invokedRun.result && <div><span>底座成果 #{invokedRun.result.artifact_id}</span><button className="secondary" onClick={() => void previewInvokedApplication()}>在分析室查看成果</button></div>}</article>}
      {appPreview && <iframe title="分析室应用成果预览" sandbox="" srcDoc={appPreview} />}
    </section>}
    <details className="finance-scope-panel" open={!thread}><summary>本次分析范围与成果类型 <span>{goalLabel[goal]}</span></summary><FinancialScope workspace={workspace} disabled={running} value={scopeChoice} onChange={changeScope} onCatalog={setScopeCatalog} /></details>
    <div className="finance-conversation" aria-live="polite">
      {!userMessages.length && <div className="finance-welcome"><Sparkles size={24} /><h2>{roomMode === 'create' ? '描述您希望长期复用的财务分析工作' : roomMode === 'use' ? '可直接运行已有应用，也可以载入对话调整' : '请告诉我您想核对的财务经营问题'}</h2><p>{roomMode === 'create' ? '我会与您梳理业务目标、指标、数据条件、分析方法、看板组件和报告结构；确认后可保存为当前空间的新应用。' : '我会先确认主体和期间，再核验真实数据、财务口径与知识依据；需要形成看板或报告时会单独登记成果。'}</p></div>}
      {userMessages.map((message, index) => { const current = index === userMessages.length - 1; const assistantText = current ? answer : assistantMessages[index]; return <div className="chat-turn" key={`${index}:${message}`}><article className="chat-bubble chat-user"><span>您</span><p>{message}</p></article>{(current || assistantText) && <article className="chat-bubble chat-assistant"><span>衡策财务分析师</span>{current && running && !answer && <p className="chat-thinking">正在核验数据范围和分析依据…</p>}{assistantText && <RichText>{assistantText}</RichText>}{current && <><FinancialAnalysisBlocks value={progress} />
        {!!clarificationQuestions?.length && <ClarificationForm key={(interrupt!.clarification as Clarification).clarification_id} value={interrupt!.clarification as Clarification} disabled={running} onSubmit={answers => void analyze({ structured: answers })} />}
        {confirmation && <AnalysisConfirmation value={confirmation} disabled={running} onDecision={decision => void analyze({ confirmation: { revision: confirmation.revision, decision } })} />}
        {interrupt && !confirmation && !clarificationQuestions?.length && <div className="platform-interrupt"><h4>请确认业务口径</h4><p>{interruptMessage(interrupt)}</p><label>补充说明<textarea value={clarification} onChange={event => setClarification(event.target.value)} placeholder="补充主体范围、预算版本、差异方向或其他业务口径" /></label><div className="platform-toolbar"><button className="primary" disabled={running || !clarification.trim()} onClick={() => void analyze({ feedback: clarification.trim() })}>提交补充并继续</button><button className="secondary" disabled={running} onClick={() => void analyze({ feedback: 'accepted' })}>确认当前口径</button></div></div>}
        {sessionResult.data_table && <details className="business-evidence"><summary>查看本次数据明细</summary><ResultTable {...sessionResult.data_table} maxRows={200} caption="数据库返回明细" className="table-wrap" /></details>}
        {sessionResult.generated_sql && <details className="technical-details"><summary>数据依据与高级信息</summary><p>查询逻辑默认折叠，仅供有权限的复核人员追溯。</p><pre>{sessionResult.generated_sql}</pre><button className="secondary" disabled={busy || running} onClick={() => void run(async () => {
          const saved = await api<{ id: number; workspace_id: number }>('/api/askdata/production-artifacts', { workspace_id: Number(workspace), title: userMessages[0]?.slice(0, 200) || '财务分析依据', canonical_question: userMessages[0], artifact_type: 'sql_snippet', source_session_id: thread, payload_ref: { sql_text: sessionResult.generated_sql, data_table: sessionResult.data_table, domain_codes: ['function.finance'] } });
          if (!saved.id) throw new Error('底座未返回成果 ID，尚不能确认保存成功'); setSavedArtifact(saved); await refreshWorkspace(); setNotice('分析依据已保存为平台成果');
        })}>保存分析依据为成果</button></details>}
        {savedArtifact && <p role="status">分析依据已存入当前空间 · 成果 #{savedArtifact.id}，可在财务成果中心继续使用。</p>}
        {sessionResult.report_card && <section className="generated-result"><h4>{sessionResult.report_card.title}</h4><p>{sessionResult.report_card.production_artifact_id ? `H5 草稿已登记为财务成果 #${sessionResult.report_card.production_artifact_id}，请前往成果中心完成专业复核。` : sessionResult.report_card.registration_status === 'failed' ? 'H5 已生成，但成果登记失败，请由平台管理员重试登记。' : 'H5 草稿已生成，正在确认成果登记状态。'}</p>{artifactUrl({ id: thread, title: '报告', artifact_type: 'report', payload_ref: { url: sessionResult.report_card.url } }) && <a className="secondary" href={sessionResult.report_card.url} target="_blank" rel="noopener noreferrer">预览 H5 报告</a>}</section>}
        {sessionResult.dashboard_card && <section className="generated-result"><h4>{sessionResult.dashboard_card.title || '本次生成看板'}</h4><p>{sessionResult.dashboard_card.publish_verified ? '看板已通过生成校验，可预览后保存为当前空间成果。' : '看板仍在校验，暂不可保存。'}</p>{artifactUrl({ id: thread, title: '看板', artifact_type: 'dashboard', payload_ref: { url: sessionResult.dashboard_card.url } }) && <a className="secondary" target="_blank" rel="noopener noreferrer" href={artifactUrl({ id: thread, title: '看板', artifact_type: 'dashboard', payload_ref: { url: sessionResult.dashboard_card.url } })}>预览实际看板</a>}<button className="primary" disabled={busy || running || !sessionResult.dashboard_card.publish_verified || !sessionResult.dashboard_card.scene_id} onClick={() => void run(async () => { await api('/api/askdata/dashboard-collaboration/finalize', { workspace_id: Number(workspace), scene_id: sessionResult.dashboard_card!.scene_id, dashboard_url: sessionResult.dashboard_card!.url, title: sessionResult.dashboard_card!.title, source_session_id: thread, canonical_question: userMessages[0], domain_code: 'function.finance' }); await refreshWorkspace(); setNotice('看板已确认并保存到平台成果'); })}>复核满意并保存看板</button></section>}
        {roomMode === 'create' && answer && !running && !interrupt && <section className="save-application"><span className="v2-eyebrow">将本轮设计沉淀到当前空间</span><h4>保存为可复用财务智能分析应用</h4><div><label>应用名称<input aria-label="新财务应用名称" value={applicationTitle} onChange={event => setApplicationTitle(event.target.value)} placeholder="例如：区域盈利与现金协同分析" /></label><label>默认成果<select aria-label="新应用默认成果" value={applicationDeliverable} onChange={event => setApplicationDeliverable(event.target.value as 'dashboard' | 'report')}><option value="dashboard">动态看板</option><option value="report">专业 H5 报告</option></select></label><button className="primary" disabled={busy || !applicationTitle.trim()} onClick={() => void saveAsFinanceApplication()}>保存到空间应用库</button></div><p>保存的是经本轮问答形成的业务目标和分析蓝图；再次调用时仍会读取最新空间数据，不冻结当前数值。</p></section>}
        </>}
      </article>}</div>; })}
    </div>
    {runStatus === 'cancel_requested' && <p role="status" className="chat-run-status">正在安全结束当前分析步骤…</p>}{runStatus === 'cancelled' && <p role="status" className="chat-run-status">平台已确认：分析已取消。</p>}{restoredContext && <p className="chat-run-status">已恢复原会话的问题、分析范围与资源版本。</p>}
    <footer className="finance-composer"><div className="composer-options"><label>期望成果<select aria-label="期望成果" value={goal} disabled={running || !!interrupt} onChange={event => { setGoal(event.target.value); setGenerationConfirmed(false); }}><option value="data_analysis">财务经营分析</option><option value="knowledge_qa">财务知识问答</option><option value="dashboard">生成动态看板</option><option value="report">生成 H5 报告</option></select></label>{['report', 'dashboard'].includes(goal) && <label className="generation-confirm"><input type="checkbox" checked={generationConfirmed} disabled={running} onChange={event => setGenerationConfirmed(event.target.checked)} />确认生成草稿将执行额外分析，且不等于发布</label>}</div><div className="composer-input"><textarea aria-label="向财务分析师提问" rows={3} value={query} disabled={running || !!interrupt} onChange={event => setQuery(event.target.value)} placeholder={userMessages.length ? '继续追问原因、风险、业务影响或改进建议…' : '例如：分析本期各事业部利润预算差异，并从销售、采购和费用环节说明待核验原因。'} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void analyze({ followup: !!thread }); } }} />{running ? <button className="composer-send secondary" onClick={() => abort.current?.abort()}><Square size={17} />停止接收</button> : <button className="composer-send primary" disabled={busy || !query.trim() || !!interrupt} onClick={() => void analyze({ followup: !!thread })}><Send size={17} />{thread ? '继续追问' : '发送问题'}</button>}</div>{thread && ['running', 'cancel_requested'].includes(runStatus) && <button className="cancel-run" disabled={busy || runStatus === 'cancel_requested'} onClick={() => void run(requestCancellation)}>取消平台执行</button>}</footer>
  </section>;
}
