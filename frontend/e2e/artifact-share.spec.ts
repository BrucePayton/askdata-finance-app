import { expect, test } from '@playwright/test';

test('base artifact sharing separates authenticated link, consent, expiry and revocation', async ({ page }) => {
  test.skip(!process.env.FINANCE_E2E_USERNAME || !process.env.FINANCE_E2E_PASSWORD, 'Requires local base login');
  const origin = new URL(process.env.FINANCE_E2E_BASE_URL || 'http://127.0.0.1:18080').origin;
  let created = false;
  const shareId = 'a'.repeat(64);
  await page.route('**/api/askdata/production-artifacts/*/shares**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.confirm_external).toBe(true);
      expect(body.expires_hours).toBe(1);
      created = true;
      await route.fulfill({ json: { code: 0, payload: { share_path: '/api/askdata/public-artifact-share#' + 't'.repeat(43), share_id: shareId } } });
    } else if (route.request().method() === 'DELETE') {
      created = false;
      await route.fulfill({ json: { code: 0, payload: { revoked: true } } });
    } else {
      await route.fulfill({ json: { code: 0, payload: { items: created ? [{ share_id: shareId, expires_at: '2099-01-01T00:00:00Z', valid: true }] : [] } } });
    }
  });
  await page.goto(origin + '/chain-studio?tab=production&workspace_id=1');
  await page.locator('#login_identifier').fill(process.env.FINANCE_E2E_USERNAME!);
  await page.locator('#password').fill(process.env.FINANCE_E2E_PASSWORD!);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: '分享报告', exact: true }).first()).toBeVisible({ timeout: 20000 });
  // Published technical acceptance reports are below the newer drafts.
  const cards = page.locator('[data-slot="card"]').filter({ hasText: '已发布' });
  const share = cards.getByRole('button', { name: '分享报告', exact: true }).first();
  if (await share.count()) await share.click();
  else {
    // Current Card implementation has no data-slot attribute.
    await page.getByRole('button', { name: '分享报告', exact: true }).nth(2).click();
  }
  await expect(page.getByLabel('站内成果链接')).toHaveValue(/chain-studio\?tab=production&workspace_id=1&artifact_id=\d+/);
  await expect(page.getByRole('button', { name: '生成并复制外链' })).toBeDisabled();
  await page.getByLabel('分享有效期').selectOption('1');
  await page.getByLabel('我确认快照可供持有链接的外部人员阅读').check();
  await page.getByRole('button', { name: '生成并复制外链' }).click();
  await expect(page.getByLabel('外部分享链接')).toHaveValue(/public-artifact-share#t{43}$/);
  await page.getByRole('button', { name: '撤销分享', exact: true }).click();
  await expect(page.getByText('分享已撤销，已被下载的内容无法追回')).toBeVisible();
  expect(created).toBe(false);
});

test('anonymous share shell renders sandboxed content and handles revoked links', async ({ page }) => {
  const origin = new URL(process.env.FINANCE_E2E_BASE_URL || 'http://127.0.0.1:18080').origin;
  let revoked = false;
  await page.route('**/api/askdata/public-artifact-share/content', async route => {
    expect(route.request().headers()['authorization']).toBeUndefined();
    expect(route.request().postDataJSON().token).toBe('t'.repeat(43));
    await route.fulfill(revoked ? { status: 410, body: '{}' } : { contentType: 'text/html', body: '<h1>只读分享测试</h1><table><tr><td>测试数值</td></tr></table>' });
  });
  await page.goto(origin + '/api/askdata/public-artifact-share#' + 't'.repeat(43));
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '只读分享测试' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', '');
  revoked = true;
  await page.reload();
  await expect(page.getByText('分享不可用：可能已过期、撤销或成果已变更。')).toBeVisible();
});
