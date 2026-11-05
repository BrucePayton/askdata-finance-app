import { lazy, Suspense, useEffect, useState } from 'react';
import { Activity, BarChart3, BookOpen, BriefcaseBusiness, CheckCircle2, ChevronRight, ClipboardCheck, FileText, LayoutDashboard, RefreshCw, Sparkles, MessageCircleMore, ShieldCheck, Wrench } from 'lucide-react';
import { platformRequest as api, platformToken, setPlatformToken } from './platform';
import { PlatformCenter } from './PlatformCenter';
import { FinanceApplication } from './FinanceApplication';
import type { ScopeCatalog, ScopeChoice } from './FinancialScope';
import './finance-v2.css';

const FinanceOverview = lazy(() => import('./FinanceOverview'));
type Page = 'workbench' | 'qa' | 'records' | 'assets' | 'application';
type Workspace = { id: number; name: string };
type AppDefinition = { app_id: string; topic_id: string; app_type: 'dashboard' | 'report'; refresh_mode: 'live' | 'snapshot' | 'hybrid'; render_engine: 'native_dashboard' | 'h5_report' | 'plotly_report'; refresh_creates_version: boolean; upstream_app_id?: string; name: string; category: string; business_question: string; version: string; skill_refs: string[] };
type WorkspaceContext = {
  workspace_id: number; context_revision: string;
  scope_catalog: ScopeCatalog & { dataset_name: string; as_of: string };
  source: { legacy_profile: boolean };
  apps: AppDefinition[]; limitations: string[];
  app_readiness: { app_id: string; calculation_available: boolean; status: string; reasons: string[] }[];
};
type Resource = { key: string; id: number; name: string; description: string; kind: string; status: string; active: boolean; mounted: boolean; version: string; capabilities?: string[]; validation?: { checked_at?: string; tools?: string[]; message?: string } };
type ResourceCatalog = { items: Resource[]; version: string };
type FinanceRun = { id: string; app_id: string; status: string; created_at?: string; result?: { artifact_id?: number; title?: string; product_type?: string } };
const pages: [Page, string, typeof BarChart3][] = [
  ['qa', '智能分析入口', Sparkles], ['workbench', '经营驾驶舱', BriefcaseBusiness], ['records', '成果中心', ClipboardCheck], ['assets', '分析资产', BookOpen],
];
const sceneFor = (app: string): ScopeChoice['scene'] => app === 'budget' ? 'budget' : app === 'cash' ? 'cash' : app === 'receivables' ? 'receivables' : 'operating';
const financePath = (workspace: string) => `/api/application-center/v1/workspaces/${workspace}/applications/finance`;

function FinanceAssets({ workspace, revision, apps, onUse }: { workspace: string; revision: number; apps: AppDefinition[]; onUse: (question: string, app?: AppDefinition) => void }) {
  const [catalog, setCatalog] = useState<ResourceCatalog>();
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  const normalize = (result: ResourceCatalog) => ({ ...result, items: result.items.filter(item => ['skill', 'mcp_server'].includes(item.kind)) });
  async function load() { setCatalog(normalize(await api<ResourceCatalog>(`${financePath(workspace)}/resources`))); }
  useEffect(() => {
    let current = true;
    setCatalog(undefined); setError(''); setNotice('');
    api<ResourceCatalog>(`${financePath(workspace)}/resources`).then(result => { if (current) setCatalog(normalize(result)); }).catch(reason => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, [workspace, revision]);
  async function validate() {
    setBusy('validate'); setError(''); setNotice('');
    try { const result = await api<{ status: string }>(`${financePath(workspace)}/validate`, {}); await load(); setNotice(result.status === 'verified' ? '全部专业资产已通过运行校验。' : '校验已完成，请处理未就绪资产后再运行相关应用。'); }
    catch (reason) { setError((reason as Error).message); } finally { setBusy(''); }
  }
  async function inspect(resource: Resource) {
    setBusy(resource.key); setError(''); setNotice('');
    try {
      if (resource.kind === 'skill') {
        const result = await api<{ instructions: string }>(`${financePath(workspace)}/skills/${encodeURIComponent(resource.key)}`);
        setNotice(`${resource.name}已成功加载（${result.instructions.trim().length} 字方法说明），可在分析室调用。`);
        await load();
      } else await validate();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(''); }
  }
  const resources = catalog?.items;
  const verified = resources?.filter(item => item.status === 'verified').length || 0;
  return <section aria-label="当前空间分析资产">
    <div className="v2-intro asset-intro"><div><span className="v2-eyebrow">METHODS · TOOLS · APPLICATIONS</span><h2>专业能力已装配到财务应用</h2><p>查看每项方法和工具是否真正可用、被哪些应用使用，并可直接带入分析室开展工作。</p></div><button className="primary" disabled={!!busy || !resources?.length} onClick={() => void validate()}><ShieldCheck size={17} />{busy === 'validate' ? '正在校验…' : '检查全部资产'}</button></div>
    {error && <p role="alert" className="v2-error">{error}</p>}{notice && <p role="status" className="v2-success">{notice}</p>}
    {!resources && !error && <p role="status">正在读取空间分析资产…</p>}
    {resources?.length === 0 && <p>当前空间尚未绑定可用分析资产，请联系空间维护者。</p>}
    {resources && <div className="asset-summary"><span><strong>{resources.length}</strong>项专业资产</span><span><strong>{verified}</strong>项运行校验通过</span><span><strong>{apps.length}</strong>个应用已编排</span></div>}
    <div className="v2-apps">{resources?.map(resource => { const dependents = apps.filter(app => app.skill_refs.includes(resource.key)); return <article key={resource.key} className="v2-card asset-card">
      <div className="asset-card-head"><span className="v2-eyebrow">{resource.kind === 'skill' ? '专业分析方法' : '受控计算工具'}</span><span className={`asset-status ${resource.status}`}>{resource.status === 'verified' ? '可用' : resource.status === 'failed' ? '校验失败' : resource.status === 'unmounted' ? '未装配' : resource.status === 'disabled' ? '已停用' : '待校验'}</span></div>
      <h3>{resource.name}</h3><p>{resource.description}</p>
      <div className="asset-uses"><strong>已用于</strong>{dependents.length ? dependents.map(app => <button key={app.app_id} onClick={() => onUse('', app)}>{app.name}</button>) : <span>尚未被固定应用引用，可在分析室按需调用</span>}</div>
      {!!resource.validation?.tools?.length && <details><summary>可用计算能力</summary><p>{resource.validation.tools.join('、')}</p></details>}
      <details><summary>资产依据</summary><p>当前空间资产 #{resource.id}。运行校验只确认方法可加载或工具可发现，财务结论仍需专业复核。</p></details>
      <small>{resource.active && resource.mounted ? '当前空间已装配' : '当前空间不可运行'} · v{resource.version}{resource.validation?.checked_at ? ` · 最近校验 ${new Date(resource.validation.checked_at).toLocaleString('zh-CN')}` : ''}</small>
      <div className="asset-actions"><button className="secondary" disabled={!!busy || !resource.active || !resource.mounted} onClick={() => void inspect(resource)}><Wrench size={15} />{busy === resource.key ? '正在检查…' : '验证可调用'}</button><button className="primary" disabled={!resource.active || !resource.mounted} onClick={() => onUse(`请使用“${resource.name}”专业资产，基于当前空间真实数据开展财务分析。先说明适用场景与所需口径，再给出财务结论、经营影响和建议。`)}><Sparkles size={15} />在分析室使用</button></div>
    </article>; })}</div>
    <p className="v2-note">这里只编排当前空间已经提供的专业能力，不在财务应用中心修改数据连接、知识库或其他空间的全局配置。</p>
  </section>;
}

function OperatingCockpit({ current, workspace, revision, search, setSearch, onUse, onOpen }: { current: WorkspaceContext; workspace: string; revision: number; search: string; setSearch: (value: string) => void; onUse: (question: string, app?: AppDefinition) => void; onOpen: (app: AppDefinition) => void }) {
  const [runs, setRuns] = useState<FinanceRun[]>([]);
  useEffect(() => {
    let active = true;
    api<{ items: FinanceRun[] }>(`${financePath(workspace)}/runs`).then(value => { if (active) setRuns(value.items || []); }).catch(() => { if (active) setRuns([]); });
    return () => { active = false; };
  }, [workspace, revision]);
  const topics = [...new Set(current.apps.map(item => item.topic_id))].map(topic => ({ topic, apps: current.apps.filter(item => item.topic_id === topic) })).filter(group => group.apps.some(item => `${item.name} ${item.business_question}`.includes(search)));
  const ready = current.app_readiness.filter(item => item.calculation_available).length;
  return <>
    <div className="cockpit-status"><span><LayoutDashboard /><b>{current.apps.filter(item => item.app_type === 'dashboard').length}</b><small>动态看板</small></span><span><FileText /><b>{current.apps.filter(item => item.app_type === 'report').length}</b><small>专业报告</small></span><span><CheckCircle2 /><b>{ready}/{current.apps.length}</b><small>应用就绪</small></span><span><Activity /><b>{runs.filter(item => ['queued', 'running'].includes(item.status)).length}</b><small>后台运行中</small></span></div>
    <Suspense fallback={<p role="status">正在加载经营图表…</p>}><FinanceOverview key={`${workspace}:${current.context_revision}`} workspace={workspace} revision={current.context_revision} catalog={current.scope_catalog} onAsk={onUse} /></Suspense>
    <div className="v2-section-heading"><div><span className="v2-eyebrow">OPERATING TOPICS</span><h2>经营主题应用矩阵</h2></div><input aria-label="搜索财务应用" placeholder="搜索经营主题或业务问题" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <p className="v2-note">每个主题由可刷新看板承接日常监控，并向专业报告提供同口径的前置快照。</p>
    <div className="topic-grid">{topics.map(group => { const dashboard = group.apps.find(item => item.app_type === 'dashboard'); const report = group.apps.find(item => item.app_type === 'report'); const lead = dashboard || report!; return <article className="topic-card" key={group.topic}><div><span className="v2-eyebrow">{lead.category}</span><h3>{lead.name.replace(/看板|报告/g, '').replace(/与$/, '')}</h3><p>{lead.business_question}</p></div><div className="topic-products">{dashboard && <button aria-label="打开看板应用" onClick={() => onOpen(dashboard)}><LayoutDashboard size={18} /><span><strong>动态看板</strong><small>{current.app_readiness.find(item => item.app_id === dashboard.app_id)?.calculation_available ? '数据就绪 · 可刷新' : '数据能力受限'}</small></span><ChevronRight size={16} /></button>}{report && <button aria-label="打开报告应用" onClick={() => onOpen(report)}><FileText size={18} /><span><strong>{report.refresh_mode === 'hybrid' ? '交互报告' : '冻结报告'}</strong><small>引用看板口径 · 可复核</small></span><ChevronRight size={16} /></button>}</div><button className="topic-ask" onClick={() => onUse('', lead)}><MessageCircleMore size={16} />在分析室研判该主题</button></article>; })}</div>
    {runs.length > 0 && <section className="recent-runs"><div className="v2-section-heading"><h2>最近应用运行</h2><span>仅展示当前账号在本空间的真实任务</span></div>{runs.slice(0, 5).map(run => <div key={run.id}><span className={`run-dot ${run.status}`} /><strong>{current.apps.find(item => item.app_id === run.app_id)?.name || run.app_id}</strong><small>{run.status === 'completed' ? '已生成成果' : run.status === 'running' ? '正在分析' : run.status === 'queued' ? '等待执行' : '执行失败'}{run.result?.artifact_id ? ` · 成果 #${run.result.artifact_id}` : ''}</small><time>{run.created_at ? new Date(run.created_at).toLocaleString('zh-CN') : ''}</time></div>)}</section>}
  </>;
}

export function FinanceCenterV2() {
  const [page, setPage] = useState<Page>('qa');
  const [credential, setCredential] = useState(platformToken());
  const [login, setLogin] = useState({ username: '', password: '' });
  const [loginBusy, setLoginBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [context, setContext] = useState<WorkspaceContext>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [app, setApp] = useState<AppDefinition>();
  const [search, setSearch] = useState('');
  const [roomQuestion, setRoomQuestion] = useState<string>();

  useEffect(() => {
    const changed = () => {
      setCredential(platformToken()); setWorkspace(''); setWorkspaces([]); setContext(undefined);
      setApp(undefined); setRoomQuestion(undefined); setError('');
    };
    window.addEventListener('finance-platform-auth', changed);
    return () => window.removeEventListener('finance-platform-auth', changed);
  }, []);
  useEffect(() => {
    let current = true;
    if (!credential) return;
    api<{ workspaces: Workspace[] }>('/api/wp/workspaces?page=1&page_size=100').then(result => {
      if (!current) return;
      setWorkspaces(result.workspaces);
      setWorkspace(previous => result.workspaces.some(item => String(item.id) === previous) ? previous : String(result.workspaces[0]?.id || ''));
    }).catch(reason => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, [credential, revision]);
  useEffect(() => {
    let current = true;
    setContext(undefined); setError('');
    if (!credential || !workspace) return;
    api<WorkspaceContext>(`${financePath(workspace)}/context`).then(result => {
      if (current && result.workspace_id === Number(workspace)) setContext(result);
    }).catch(reason => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, [credential, workspace, revision]);
  // Refreshing the page context never publishes an artifact or modifies a binding.
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible' && platformToken()) setRevision(value => value + 1); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, []);

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setLoginBusy(true); setError('');
    try {
      const result = await api<{ token: string }>('/api/user/login', { login_identifier: login.username, password: login.password, login_type: 'username' });
      if (!result.token) throw new Error('登录响应缺少认证信息');
      setPlatformToken(result.token); setLogin(value => ({ ...value, password: '' }));
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoginBusy(false); }
  }
  function navigate(next: Page) { setPage(next); setApp(undefined); setRoomQuestion(undefined); }
  function changeWorkspace(next: string) {
    setWorkspace(next); setContext(undefined); setApp(undefined); setRoomQuestion(undefined); setError('');
  }
  function openQuestion(question: string, selectedApp?: AppDefinition) {
    setPage('qa'); setApp(selectedApp); setRoomQuestion(question);
  }
  const current = context?.workspace_id === Number(workspace) ? context : undefined;
  const selectedWorkspace = workspaces.find(item => String(item.id) === workspace);
  const inRoom = page === 'qa';
  const title = page === 'application' ? '财务分析应用' : page === 'qa' ? '智能财务分析室' : pages.find(item => item[0] === page)![1];
  return <div className="v2-shell">
    <aside className="v2-sidebar"><div className="v2-brand"><BarChart3 /><span>衡策<small>FINANCE INTELLIGENCE</small></span></div>
      <nav aria-label="财务主导航">{pages.map(([id, label, Icon]) => <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={19} />{label}</button>)}</nav>
      <p>业务分析在这里<br />数据与知识由底座承载</p>
    </aside>
    <main className="v2-main"><header className="v2-header"><div><span className="v2-eyebrow">{selectedWorkspace?.name || '财务应用中心'}</span><h1>{title}</h1></div>
      {credential && <div className="v2-controls"><label>当前空间<select aria-label="当前空间" value={workspace} onChange={event => changeWorkspace(event.target.value)}><option value="">请选择空间</option>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button className="secondary" onClick={() => setRevision(value => value + 1)} aria-label="刷新空间"><RefreshCw size={17} /></button>
        <button className="secondary" onClick={() => setPlatformToken('')}>退出登录</button></div>}
    </header>
    {error && <div className="v2-error" role="alert">{error}。未加载的数据不会用示例结果代替。</div>}
    {!credential ? <section className="v2-login v2-card"><span className="v2-eyebrow">使用底座账号</span><h2>登录后，直接开始财务分析</h2><p>自动加载您有权访问的空间、数据与分析方法，无需在此配置连接或知识库。</p>
      <form onSubmit={signIn}><label>平台用户名<input required autoComplete="username" value={login.username} onChange={event => setLogin({ ...login, username: event.target.value })} /></label><label>平台密码<input required type="password" autoComplete="current-password" value={login.password} onChange={event => setLogin({ ...login, password: event.target.value })} /></label><button className="primary" disabled={loginBusy}>{loginBusy ? '正在登录…' : '登录财务应用中心'}</button></form>
      <small>认证令牌仅保存在内存，刷新页面后需重新登录。</small></section>
    : !workspace ? <section className="v2-card"><h2>请选择可访问空间</h2><p>没有可用空间时，请由底座维护者授予访问权限。</p></section>
    : page === 'application' && app && current ? <><button className="secondary" onClick={() => navigate('workbench')}>← 返回财务工作台</button><FinanceApplication key={`${credential}:${workspace}:${current.context_revision}:${app.app_id}`} workspace={workspace} revision={current.context_revision} catalog={current.scope_catalog} appId={app.app_id} topicId={app.topic_id} appType={app.app_type} refreshMode={app.refresh_mode} renderEngine={app.render_engine} title={app.name} /></>
    : inRoom ? <><section className="room-intro"><div><span className="v2-eyebrow">ASK · BUILD · RUN</span><h2>从一个财务问题，走到可复用的分析应用</h2><p>{app?.business_question || '直接提问、生成新的专业应用，或调用当前空间已有应用生成动态看板与财务报告。'}</p></div><button className="secondary" onClick={() => navigate('workbench')}>查看经营驾驶舱 <ChevronRight size={16} /></button></section>
      <PlatformCenter key={`${credential}:${workspace}:${app?.app_id || 'question'}`} visible workspaceId={workspace} initialTab="analysis" initialScene={sceneFor(app?.app_id || '')} question={roomQuestion} apps={current?.apps || []} contextRevision={current?.context_revision || ''} initialAppId={app?.app_id} />
    </> : page === 'assets' ? <FinanceAssets key={`${credential}:${workspace}`} workspace={workspace} revision={revision} apps={current?.apps || []} onUse={openQuestion} />
    : page === 'records' ? <PlatformCenter key={`${credential}:${workspace}:records`} visible workspaceId={workspace} initialTab="artifacts" onReuse={openQuestion} />
    : <><section className="v2-intro"><span className="v2-eyebrow">衡策 · 财务经营洞察</span><h2>从财务数字，看见经营全貌。</h2><p>先看指标与变化，再进入独立分析室追问原因、核对依据。</p>
      <button className="primary" onClick={() => navigate('qa')}>进入智能财务分析室</button>
    </section>
    {!current && !error && <p role="status">正在读取当前空间的财务数据范围…</p>}
    {current && <><div className="v2-scope-strip"><span>数据时点 <strong>{current.scope_catalog.as_of}</strong></span><span>可用期间 <strong>{current.scope_catalog.periods[0]} — {current.scope_catalog.periods.at(-1)}</strong></span><span>主体 <strong>{current.scope_catalog.entities.length} 个</strong></span><span>口径 <strong>人民币 · 主体/月</strong></span></div>
      <OperatingCockpit current={current} workspace={workspace} revision={revision} search={search} setSearch={setSearch} onUse={openQuestion} onOpen={item => { setApp(item); setPage('application'); }} />
      <details className="v2-legacy"><summary>空间数据与能力说明</summary>{current.limitations.map(line => <p key={line}>{line}</p>)}</details>
    </>}
    </>}
    </main>
  </div>;
}
