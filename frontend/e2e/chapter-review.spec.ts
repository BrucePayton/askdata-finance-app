import { test, expect } from '@playwright/test';

test('financial chapter decisions bind frozen report version and block unfinished review', async ({ page }) => {
  let publication: Record<string, unknown> | undefined;
  await page.route('**/api/application-center/v1/user/login', route => route.fulfill({ json: { code: 0, payload: { token: 'test-token' } } }));
  await page.route('**/api/application-center/v1/wp/workspaces?*', route => route.fulfill({ json: { code: 0, payload: { workspaces: [{ id: 8, name: '复核测试空间' }] } } }));
  await page.route('**/workspaces/8/applications/finance/context', route => route.fulfill({ status: 409, json: { detail: '测试空间暂缺业务数据，既有报告仍可复核' } }));
  await page.route('**/api/application-center/v1/datasource/datasources?*', route => route.fulfill({ json: { code: 0, payload: { datasources: [] } } }));
  await page.route('**/api/application-center/v1/kb/knowledgebases?*', route => route.fulfill({ json: { code: 0, payload: { knowledgebases: [] } } }));
  await page.route('**/api/application-center/v1/wp/workspaces/8/mounted-resources', route => route.fulfill({ json: { code: 0, payload: { mounted_resources: [] } } }));
  await page.route('**/api/application-center/v1/askdata/production-artifacts?*', route => route.fulfill({ json: { code: 0, payload: { items: [{ id: 456, workspace_id: 8,
    title: '逐章复核报告', artifact_type: 'report', status: 'active', payload_ref: { review_status: 'pending_review', review_revision: 1, review_snapshot_hash: 'hash' } }], total: 1 } } }));
  await page.route('**/api/application-center/v1/askdata/production-artifacts/456/review-document?*', route => route.fulfill({ json: { code: 0, payload: {
    document_html: '<h1>冻结专业报告</h1>', chapters: [{ id: 'budget', title: '预算执行', status: 'needs_review' }], source_version: 2,
  } } }));
  await page.route('**/api/application-center/v1/askdata/production-artifacts/456/review', route => {
    publication = route.request().postDataJSON();
    return route.fulfill({ json: { code: 0, payload: {} } });
  });
  await page.goto('./');
  await page.getByLabel('平台用户名').fill('test');
  await page.getByLabel('平台密码').fill('test');
  await page.getByRole('button', { name: '登录财务应用中心' }).click();
  await expect(page.getByLabel('当前空间', { exact: true })).toHaveValue('8');
  await page.getByRole('button', { name: '成果中心', exact: true }).click();
  await page.getByRole('button', { name: '专业复核', exact: true }).click();
  await page.getByRole('button', { name: '查看冻结正文' }).click();
  await page.getByLabel('复核意见', { exact: true }).fill('已核对冻结数据版本');
  await expect(page.getByRole('button', { name: '复核并发布' })).toBeEnabled();
  await page.getByRole('button', { name: '复核并发布' }).click();
  await expect(page.getByText(/请为每个冻结章节选择/)).toBeVisible();
  await expect(page.getByLabel('预算执行复核决定').locator('option[value=approve]')).toHaveCount(0);
  await page.getByLabel('预算执行复核决定').selectOption('accept_limitations');
  await page.getByLabel('预算执行章节意见').fill('确认预算版本待补充限制，仅作技术测试');
  await page.getByRole('button', { name: '复核并发布' }).click();
  expect(publication?.expected_revision).toBe(1);
  expect(publication?.chapter_reviews).toEqual([{ chapter_id: 'budget', decision: 'accept_limitations', note: '确认预算版本待补充限制，仅作技术测试' }]);
});
