import { expect, test, type Page } from '@playwright/test';

// Isolated transport fixtures, never seeded into the application database.
async function platform(page: Page, slowFirst = false) {
  const legacyCalls: string[] = [];
  const scopes: string[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/finance/')) legacyCalls.push(path);
    let payload: unknown = {};
    if (path.endsWith('/user/login')) payload = { token: 'isolated-test-token' };
    else if (path.endsWith('/wp/workspaces')) payload = { workspaces: [{ id: 8, name: '测试空间甲' }, { id: 9, name: '测试空间乙' }] };
    else if (path.endsWith('/finance/context')) {
      const id = path.includes('/workspaces/8/') ? 8 : 9;
      scopes.push(String(id));
      if (slowFirst && id === 8) await new Promise(resolve => setTimeout(resolve, 650));
      payload = { workspace_id: id, context_revision: 'a'.repeat(64), source: { legacy_profile: false }, limitations: [],
        scope_catalog: { dataset_name: '隔离测试', currency: 'CNY', as_of: id === 8 ? '2026-07-31' : '2026-08-31', periods: ['2026-07'], entities: [id === 8 ? '甲主体' : '乙主体'], available_scopes: [{ period: '2026-07', entity: id === 8 ? '甲主体' : '乙主体' }] },
        apps: [{ app_id: 'budget', topic_id: 'budget', app_type: 'report', refresh_mode: 'hybrid', render_engine: 'plotly_report', refresh_creates_version: true, upstream_app_id: 'budget-dashboard', name: '预算执行与差异归因报告', category: '预算管理', business_question: '解释预算差异', version: '2.0.0', skill_refs: ['finance-budget'] }],
        app_readiness: [{ app_id: 'budget', calculation_available: true, status: 'degraded', reasons: [] }] };
    } else if (path.endsWith('/apps/profit/calculation')) payload = {
      metrics: { revenue: path.includes('/workspaces/8/') ? 12340000 : 56780000, operating_profit: 1200000, operating_cash: 900000, closing_cash: 2000000, overdue: null, receivables: null, revenue_attainment: 0.95, profit_variance: -100000 },
      trend: [{ period: '2026-07', revenue: 12340000, budget: 13000000 }],
      bridge: [{ label: '预算利润', value: 1300000, kind: 'total' }, { label: '差异', value: -100000, kind: 'delta' }, { label: '实际利润', value: 1200000, kind: 'total' }],
      aging: [], issues: [], warnings: ['隔离测试口径'], fingerprint: 'isolated-fixture',
    };
    else if (path.endsWith('/finance/resources')) payload = { items: [{ key: 'finance-budget', id: 12, kind: 'skill', name: '预算分析方法', description: '隔离评测资产', active: true, mounted: true, status: 'verified', version: '2.0.0' }] };
    else if (path.endsWith('/finance/validate')) payload = { status: 'verified', checks: { 'finance-budget': { status: 'verified' } } };
    else if (path.endsWith('/finance/skills/finance-budget')) payload = { id: 12, key: 'finance-budget', version: '2.0.0', instructions: '核对预算口径，执行差异归因并说明经营影响。' };
    else if (path.endsWith('/production-artifacts')) payload = { items: [], total: 0 };
    else return route.fulfill({ status: 404, json: { detail: 'Unexpected request in V2 test' } });
    await route.fulfill({ json: { code: 0, payload } });
  });
  await page.goto('/');
  await page.getByLabel('平台用户名', { exact: true }).fill('test-user');
  await page.getByLabel('平台密码', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: '登录财务应用中心', exact: true }).click();
  await expect(page.getByLabel('当前空间', { exact: true })).toHaveValue('8');
  return { legacyCalls, scopes };
}

test('four business entries, workspace-bound room, no configuration or global dataset requests', async ({ page }) => {
  const calls = await platform(page);
  const nav = page.getByRole('navigation', { name: '财务主导航' });
  await expect(nav.getByRole('button')).toHaveCount(4);
  await expect(nav).not.toContainText('数据与连接');
  await expect(page.getByRole('heading', { name: '智能财务分析室', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成新的分析应用', exact: false })).toBeVisible();
  await expect(page.getByText('财务分析场景与口径', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '分析主体', exact: true }).locator('option').filter({ hasText: '甲主体' })).toHaveCount(1);
  await expect(page.getByText('注册数据库连接', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '平台功能' })).toHaveCount(0);
  expect(calls.legacyCalls).toEqual([]);
});

test('entry room creates a reusable finance app and directly runs an existing app', async ({ page }) => {
  await platform(page);
  const blueprints: any[] = [];
  let fixedBody: Record<string, unknown> | undefined;
  await page.route('**/api/application-center/v1/askdata/production-artifacts?*', route => route.fulfill({ json: { code: 0, payload: { items: blueprints, total: blueprints.length } } }));
  await page.route('**/api/application-center/v1/askdata/production-artifacts', route => {
    const body = route.request().postDataJSON();
    blueprints.push({ id: 88, title: body.title, artifact_type: 'finance_application', payload_ref: body.payload_ref });
    return route.fulfill({ json: { code: 0, payload: { id: 88, workspace_id: 8 } } });
  });
  await page.route('**/finance/apps/budget/runs', route => {
    fixedBody = route.request().postDataJSON();
    return route.fulfill({ status: 202, json: { code: 0, payload: { id: 'room-run', app_id: 'budget', status: 'queued' } } });
  });
  await page.route('**/finance/runs/room-run', route => route.fulfill({ json: { code: 0, payload: { id: 'room-run', app_id: 'budget', status: 'completed', result: { product_type: 'report', title: '预算执行报告', artifact_id: 91 } } } }));
  await page.route('**/finance/runs/room-run/document', route => route.fulfill({ json: { code: 0, payload: { document_html: '<html><body><h1>预算执行专业报告</h1></body></html>' } } }));
  await page.getByRole('combobox', { name: '分析主体', exact: true }).selectOption('甲主体');
  await page.getByRole('combobox', { name: '分析期间', exact: true }).selectOption('2026-07');
  await page.getByRole('button', { name: '调用已有应用', exact: false }).click();
  await page.getByLabel('财务智能分析应用').selectOption('fixed:budget');
  await page.getByRole('button', { name: '直接运行固定应用' }).click();
  await expect(page.getByText('底座成果 #91')).toBeVisible({ timeout: 8000 });
  expect(fixedBody).toMatchObject({ entity: '甲主体', period: '2026-07', context_revision: 'a'.repeat(64) });
  await page.getByRole('button', { name: '在分析室查看成果' }).click();
  await expect(page.frameLocator('iframe[title="分析室应用成果预览"]').getByRole('heading', { name: '预算执行专业报告' })).toBeVisible();

  await page.route('**/api/application-center/v1/askdata/chat/stream', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: message_chunk\ndata: {"content":"## 区域盈利应用蓝图\\n包含指标、看板和报告章节。"}\n\n' }));
  await page.getByRole('button', { name: '生成新的分析应用', exact: false }).click();
  await page.getByRole('button', { name: '发送问题' }).click();
  await page.getByLabel('新财务应用名称').fill('区域盈利与现金协同分析');
  await page.getByLabel('新应用默认成果').selectOption('report');
  await page.getByRole('button', { name: '保存到空间应用库' }).click();
  await expect(page.getByText('应用 #88', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '调用已有应用', exact: false }).click();
  await expect(page.getByLabel('财务智能分析应用').locator('option').filter({ hasText: '区域盈利与现金协同分析' })).toHaveCount(1);
  expect(blueprints[0].payload_ref).toMatchObject({ schema_version: 'finance-application-blueprint/v1', deliverable: 'report', generated_from: 'finance_analysis_room' });
});

test('Hengce overview renders scoped figures and offers an independent question entry', async ({ page }) => {
  const calls = await platform(page);
  await expect(page.locator('.v2-brand')).toContainText('衡策');
  await page.getByRole('button', { name: '经营驾驶舱', exact: true }).click();
  await expect(page.locator('.overview-kpi')).toHaveCount(4);
  await expect(page.locator('.overview-kpi').first()).toContainText('1,234.0');
  await expect(page.getByRole('img', { name: '实际收入与预算收入趋势图' })).toBeVisible();
  await expect(page.getByText('所选月份没有应收快照', { exact: true })).toBeVisible();
  await page.getByLabel('当前空间', { exact: true }).selectOption('9');
  await expect(page.locator('.overview-kpi').first()).toContainText('5,678.0');
  await expect(page.locator('.overview-kpi').first()).not.toContainText('1,234.0');
  await page.getByRole('button', { name: '智能分析入口', exact: true }).click();
  await expect(page.getByRole('heading', { name: '智能财务分析室', exact: true })).toBeVisible();
  await expect(page.getByText('财务分析场景与口径', { exact: true })).toBeVisible();
  await expect(page.locator('.finance-overview')).toHaveCount(0);
  expect(calls.legacyCalls).toEqual([]);
});

test('a late response from the previous workspace cannot overwrite current scope', async ({ page }) => {
  await platform(page, true);
  await page.getByRole('button', { name: '经营驾驶舱', exact: true }).click();
  await page.getByLabel('当前空间', { exact: true }).selectOption('9');
  await expect(page.getByText('2026-08-31', { exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByText('2026-07-31', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '智能分析入口', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '分析主体', exact: true }).locator('option').filter({ hasText: '乙主体' })).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: '分析主体', exact: true }).locator('option').filter({ hasText: '甲主体' })).toHaveCount(0);
});

test('assets use canonical IDs; records ignore browser drafts and use platform artifacts', async ({ page }) => {
  const calls = await platform(page);
  await page.evaluate(() => localStorage.setItem('finance-reports-v1', '[{"title":"未核验旧草稿"}]'));
  await page.getByRole('button', { name: '分析资产', exact: true }).click();
  await expect(page.getByRole('heading', { name: '预算分析方法' })).toBeVisible();
  await page.getByRole('button', { name: '检查全部资产' }).click();
  await expect(page.getByText('全部专业资产已通过运行校验')).toBeVisible();
  await page.getByRole('button', { name: '验证可调用' }).click();
  await expect(page.getByText(/已成功加载/)).toBeVisible();
  await page.getByText('资产依据', { exact: true }).click();
  await expect(page.getByText(/当前空间资产 #12/)).toBeVisible();
  await page.getByRole('button', { name: '成果中心', exact: true }).click();
  await expect(page.getByText('未核验旧草稿', { exact: true })).toHaveCount(0);
  await expect(page.getByText('旧版浏览器草稿', { exact: true })).toHaveCount(0);
  await expect(page.getByText('系统不会用浏览器草稿或模拟记录替代', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('finance-reports-v1'))).toContain('未核验旧草稿');
  expect(calls.legacyCalls).toEqual([]);
});

test('mobile navigation fits and logout clears the visible workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await platform(page);
  await expect(page.getByRole('button', { name: '调用已有应用', exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '登录财务应用中心', exact: true })).toBeVisible();
  await expect(page.getByLabel('当前空间', { exact: true })).toHaveCount(0);
});

test('application runs a fixed backend job without chat and reloads completion after leaving', async ({ page }) => {
  await platform(page);
  await page.getByRole('button', { name: '经营驾驶舱', exact: true }).click();
  const bodies: Record<string, unknown>[] = [];
  const forbidden: string[] = [];
  page.on('request', request => { if (/chat\/stream|clarification|plan-confirm/.test(request.url())) forbidden.push(request.url()); });
  let jobs: unknown[] = [];
  await page.route('**/finance/runs', route => route.fulfill({ json: { code: 0, payload: { items: jobs } } }));
  await page.route('**/finance/apps/budget/runs', route => {
    bodies.push(route.request().postDataJSON());
    const job = { id: 'fixed-job', app_id: 'budget', status: 'queued', parameters: { entity: '甲主体', period: '2026-07' }, created_at: '2026-09-09T00:00:00Z' };
    jobs = [job];
    return route.fulfill({ status: 202, json: { code: 0, payload: job } });
  });
  await page.route('**/finance/runs/fixed-job/document', route => route.fulfill({ json: { code: 0, payload: { document_html: '<html><body><h1>预算执行专题报告</h1></body></html>' } } }));
  await page.route('**/report/app/test-user/finance-report-budget-fixed/', route => route.fulfill({ contentType: 'text/html', body: '<html><body><h1>预算 Plotly 交互报告</h1></body></html>' }));
  await page.route('**/finance/runs/fixed-job/report/refresh', route => {
    const refreshed = { id: 'refreshed-job', app_id: 'budget', status: 'queued', parameters: { entity: '甲主体', period: '2026-07' }, created_at: '2026-09-09T00:01:00Z' };
    jobs = [refreshed, ...jobs];
    return route.fulfill({ status: 202, json: { code: 0, payload: refreshed } });
  });
  await page.getByRole('button', { name: '打开报告应用', exact: true }).click();
  await expect(page.getByRole('button', { name: '运行应用', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '开始智能分析', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '运行应用', exact: true }).click();
  await expect(page.getByText(/等待执行/)).toBeVisible();
  await expect(page.getByRole('button', { name: '运行应用', exact: true })).toBeDisabled();
  expect(bodies).toHaveLength(1);
  expect(Object.keys(bodies[0]).sort()).toEqual(['context_revision', 'entity', 'idempotency_key', 'period']);
  await page.getByRole('button', { name: '经营驾驶舱', exact: true }).click();
  jobs = [{ ...(jobs[0] as object), status: 'completed', result: { product_type: 'report', artifact_id: 88, title: '预算执行专题报告', workflow_steps: [], refresh_mode: 'hybrid', render_engine: 'plotly_report', interactive_url: '/report/app/test-user/finance-report-budget-fixed/' } }];
  await page.getByRole('button', { name: '打开报告应用', exact: true }).click();
  await expect(page.getByText('已登记底座报告成果 #88')).toBeVisible();
  await page.getByRole('button', { name: '查看 Plotly 交互报告' }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '预算 Plotly 交互报告' })).toBeVisible();
  await page.getByRole('button', { name: '查看冻结 H5' }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '预算执行专题报告' })).toBeVisible();
  await page.getByRole('button', { name: '刷新并生成新版本' }).click();
  await expect(page.getByText(/等待执行/).first()).toBeVisible();
  expect(forbidden).toEqual([]);
});
