import { test, expect } from "@playwright/test";

test("installed finance resources remain visible in base platform after login", async ({ page, baseURL }) => {
  test.skip(!process.env.FINANCE_E2E_USERNAME || !process.env.FINANCE_E2E_PASSWORD, "Requires local platform credentials");
  // The standalone Vite host serves only finance; base-platform pages live on
  // the actual gateway, or an explicitly supplied platform URL.
  const platformBase = process.env.FINANCE_E2E_PLATFORM_URL || (new URL(baseURL!).port === '5178' ? 'http://127.0.0.1:18080/' : baseURL);
  const target = new URL("/external-resources?domain_code=function.finance", platformBase).href;
  await page.goto(target);
  await page.locator("#login_identifier").fill(process.env.FINANCE_E2E_USERNAME!);
  await page.locator("#password").fill(process.env.FINANCE_E2E_PASSWORD!);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(target);
  await expect(page.getByRole("cell", { name: /^财务只读分析 MCP #/ }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /^预算执行与差异分析 #/ }).first()).toBeVisible();
  // Version upgrades retain old registrations for historical workspaces.
  expect(await page.locator("tbody tr").count()).toBeGreaterThanOrEqual(7);
  await expect(page.getByRole("combobox", { name: "专业领域" })).toContainText("function.finance");
  await page.screenshot({ path: "test-results/base-finance-resources.png", fullPage: true });
});
