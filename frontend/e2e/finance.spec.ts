import { test, expect, type Page } from '@playwright/test';

test.beforeEach(() => {
  test.skip(!process.env.FINANCE_E2E_USERNAME || !process.env.FINANCE_E2E_PASSWORD,
    'Live workspace acceptance requires local credentials; no substitute demonstration data');
});

async function openFinance(page: Page) {
  await page.goto('./');
  await page.getByLabel('平台用户名').fill(process.env.FINANCE_E2E_USERNAME!);
  await page.getByLabel('平台密码').fill(process.env.FINANCE_E2E_PASSWORD!);
  await page.getByRole('button', { name: '登录财务应用中心' }).click();
  await expect(page.getByLabel('当前空间', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '智能财务分析室', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '经营驾驶舱', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开看板应用', exact: true })).toHaveCount(6);
  await expect(page.getByRole('button', { name: '打开报告应用', exact: true })).toHaveCount(6);
}

test('real workspace offers six applications and actual financial scope', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openFinance(page);
  await page.getByLabel('搜索财务应用').fill('杜邦');
  await expect(page.getByRole('button', { name: '打开看板应用', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '打开报告应用', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '智能分析入口', exact: true }).click();
  const entities = page.getByRole('combobox', { name: '分析主体', exact: true });
  await expect(entities.locator('option').nth(1)).toBeAttached();
  await entities.selectOption({ index: 1 });
  const periods = page.getByRole('combobox', { name: '分析期间', exact: true });
  await expect(periods.locator('option').nth(1)).toBeAttached();
  await periods.selectOption({ index: 1 });
  await expect(page.getByLabel('智能财务分析对话')).toBeVisible();
  await page.getByLabel('向财务分析师提问').fill('核对本期经营表现');
  await expect(page.getByRole('button', { name: '发送问题', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '生成规则分析草稿', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '成果中心', exact: true }).click();
  await expect(page.getByRole('heading', { name: '平台持久化成果' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('real bound assets and mobile layout without exposing database configuration', async ({ page }) => {
  await openFinance(page);
  await page.getByRole('button', { name: '分析资产', exact: true }).click();
  await expect(page.locator('.v2-card').filter({ hasText: '专业分析方法' })).toHaveCount(6);
  await expect(page.getByRole('button', { name: '应用安装与校验（管理员）' })).toHaveCount(0);
  await page.getByRole('button', { name: '经营驾驶舱', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expect(page.locator('.overview-kpi')).toHaveCount(4);
  await expect(page.getByRole('img', { name: '实际收入与预算收入趋势图' })).toBeVisible();
  await expect(page.locator('.v2-brand')).toContainText('衡策');
  await page.screenshot({ path: 'test-results/finance-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/finance-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '智能分析入口', exact: true }).click();
  await expect(page.getByText('财务分析场景与口径', { exact: true })).toBeVisible();
});

test('six fixed applications finish in the backend and register actual H5 drafts', async ({ page }) => {
  test.skip(process.env.FINANCE_RUN_ACCEPTANCE !== '1', 'Explicit live run acceptance creates six internal report drafts');
  test.setTimeout(180000);
  const contextResponse = page.waitForResponse(response => response.url().endsWith('/finance/context') && response.status() === 200);
  await openFinance(page);
  const response = await contextResponse;
  const context = (await response.json()).payload;
  const authorization = response.request().headers()['authorization'];
  const headers = { Authorization: authorization };
  const base = `/api/application-center/v1/workspaces/${context.workspace_id}/applications/finance`;
  const period = [...context.scope_catalog.periods].sort().at(-1);
  const runs: { id: string; app: string }[] = [];
  for (const app of ['profit', 'budget', 'cash', 'receivables', 'dupont', 'quality']) {
    const body = { period, entity: 'all', context_revision: context.context_revision, idempotency_key: `acceptance-${app}-${Date.now()}` };
    const created = await page.request.post(`${base}/apps/${app}/runs`, { headers, data: body });
    expect(created.status()).toBe(202);
    const job = (await created.json()).payload;
    const repeat = await page.request.post(`${base}/apps/${app}/runs`, { headers, data: body });
    expect((await repeat.json()).payload.id).toBe(job.id);
    runs.push({ id: job.id, app });
  }
  // Leaving the application is not cancellation and does not drive execution.
  await page.getByRole('button', { name: '成果中心', exact: true }).click();
  for (const job of runs) {
    let finished: any;
    await expect.poll(async () => {
      const status = await page.request.get(`${base}/runs/${job.id}`, { headers });
      finished = (await status.json()).payload;
      return finished.status;
    }, { timeout: 120000, intervals: [1000, 2000] }).toBe('completed');
    const doc = await page.request.get(`${base}/runs/${job.id}/document`, { headers });
    expect(doc.status()).toBe(200);
    expect((await doc.json()).payload.document_html).toContain('<html');
    expect(finished.result.artifact_id).toBeGreaterThan(0);
    const artifacts = await page.request.get(`/api/application-center/v1/askdata/production-artifacts?workspace_id=${context.workspace_id}&page=1&page_size=100`, { headers });
    expect((await artifacts.json()).payload.items.some((item: any) => item.id === finished.result.artifact_id)).toBe(true);
  }
  await page.getByRole('button', { name: '经营驾驶舱', exact: true }).click();
  await page.getByRole('button', { name: '打开报告应用', exact: true }).first().click();
  await page.getByRole('button', { name: '查看 H5 报告' }).first().click();
  await expect(page.frameLocator('iframe[title="财务应用 H5 报告"]').getByRole('heading', { level: 1 })).toBeVisible();
});
