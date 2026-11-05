import { test, expect } from "@playwright/test";
import { readEventStream } from "../src/platform";

test("SSE parser preserves UTF-8, CRLF, multi-line data and trailing event", async () => {
  const bytes = new TextEncoder().encode('event: message_chunk\r\ndata: {"content":\r\ndata: "财务"}\r\n\r\nevent: interrupt\ndata: {"content":"确认"}');
  const response = new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
  const events: unknown[] = [];
  await readEventStream(response, e => events.push(e));
  expect(events).toEqual([{ event: "message_chunk", data: { content: "财务" } }, { event: "interrupt", data: { content: "确认" } }]);
});

test("non-stream response is not shown as a generated report", async () => {
  await expect(readEventStream(new Response('{}', { headers: { "Content-Type": "application/json" } }), () => {})).rejects.toThrow("未返回事件流");
});

test("platform login unwraps payload and loads authorized resources", async ({ page }) => {
  await page.route('**/workspaces/8/applications/finance/apps/profit/calculation', route => route.fulfill({ status: 503, json: { detail: 'Overview unavailable in isolated streaming test' } }));
  await page.route('**/workspaces/8/applications/finance/runs', route => route.fulfill({ json: { code: 0, payload: { items: [] } } }));
  await page.route('**/workspaces/8/applications/finance/context', route => route.fulfill({ json: { code: 0, payload: {
    workspace_id: 8, context_revision: 'a'.repeat(64), source: { legacy_profile: false }, limitations: [],
    scope_catalog: { as_of: '2026-08-31', currency: 'CNY', periods: ['2026-08'], entities: ['事业部甲'], available_scopes: [{ entity: '事业部甲', period: '2026-08' }] },
    apps: [{ app_id: 'profit', topic_id: 'profit', app_type: 'report', refresh_mode: 'snapshot', render_engine: 'h5_report', refresh_creates_version: true, upstream_app_id: 'profit-dashboard', name: '盈利分析报告', category: '经营', business_question: '查询经营表现', version: '2.0.0', skill_refs: ['finance-profit'] }],
    app_readiness: [{ app_id: 'profit', calculation_available: true, status: 'degraded', reasons: [] }],
  } } }));
  await page.route("**/api/application-center/v1/user/login", route => route.fulfill({ json: { code: 0, payload: { token: "test-only-token" } } }));
  await page.route("**/api/application-center/v1/wp/workspaces?*", route => route.fulfill({ json: { code: 0, payload: { workspaces: [{ id: 8, name: "接口测试空间" }] } } }));
  await page.route("**/api/application-center/v1/datasource/datasources?*", route => route.fulfill({ json: { code: 0, payload: { datasources: [] } } }));
  await page.route("**/api/application-center/v1/kb/knowledgebases?*", route => route.fulfill({ json: { code: 0, payload: { knowledgebases: [] } } }));
  await page.route("**/api/application-center/v1/wp/workspaces/8/mounted-resources", route => route.fulfill({ json: { code: 0, payload: { mounted_resources: [] } } }));
  let reportRegistered = false;
  let reviewState = "draft", reviewRevision = 0;
  const reviewCalls: Record<string, unknown>[] = [];
  await page.route("**/api/application-center/v1/askdata/production-artifacts/456/review", route => {
    const body = route.request().postDataJSON(); reviewCalls.push(body);
    if (body.expected_revision !== reviewRevision) return route.fulfill({ status: 409, json: { detail: "版本冲突" } });
    reviewState = body.action === "submit" ? "pending_review" : "published"; reviewRevision++;
    return route.fulfill({ json: { code: 0, payload: {} } });
  });
  await page.route("**/api/application-center/v1/askdata/production-artifacts/456/review-document?*", route => route.fulfill({ json: { code: 0, payload: { document_html: "<h1>冻结月报正文</h1>" } } }));
  await page.route("**/api/application-center/v1/askdata/production-artifacts/456/shares", route => {
    expect(route.request().postDataJSON()).toMatchObject({ workspace_id: 8, expires_hours: 24, confirm_external: true });
    return route.fulfill({ json: { code: 0, payload: { share_path: '/api/askdata/public-artifact-share#' + 't'.repeat(43) } } });
  });
  const artifactListQueries: string[] = [];
  await page.route("**/api/application-center/v1/askdata/production-artifacts?*", route => {
    artifactListQueries.push(route.request().url());
    const items = reportRegistered ? [{ id: 456, workspace_id: 8, title: "测试H5草稿", artifact_type: "report", status: "active", payload_ref: { report_url: "/report/app/test/report", domain_codes: ["function.finance"] }, artifact_ref: { schema_version: "artifact-ref/v1", artifact_id: 456, workspace_id: 8, artifact_type: "report", status: "active", domain_codes: ["function.finance"], preview_url: "/report/app/test/report", platform_deep_link: "/chain-studio?tab=production&workspace_id=8&artifact_id=456" } }] : [];
    const reviewedItems = items.map(item => ({ ...item, payload_ref: { ...item.payload_ref, review_status: reviewState, review_revision: reviewRevision, ...(reviewRevision ? { review_snapshot_hash: "test-snapshot" } : {}) } }));
    return route.fulfill({ json: { code: 0, payload: { items: reviewedItems, total: items.length, page: 1, page_size: 12 } } });
  });
  await page.goto("./");
  await page.getByLabel("平台用户名").fill("test");
  await page.getByLabel("平台密码").fill("test");
  await page.getByRole("button", { name: "登录财务应用中心" }).click();
  await expect(page.getByLabel("当前空间", { exact: true })).toHaveValue("8");
  await expect(page.getByRole("button", { name: "测试数据库连接" })).toHaveCount(0);
  await page.getByRole("button", { name: "成果中心", exact: true }).click();
  await expect(page.getByText("当前范围尚无已登记成果", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain("test-only-token");
  let resumed: Record<string, unknown> | undefined;
  await page.route("**/api/application-center/v1/askdata/chat/stream", route => {
    const body = route.request().postDataJSON();
    if (body.clarification_submit) {
      resumed = body;
      return route.fulfill({ contentType: "text/event-stream", body: 'event: askdata_error\ndata: {"message":"测试：模型服务不可用"}\n\n' });
    }
    return route.fulfill({ contentType: "text/event-stream", body: 'event: interrupt\ndata: {"clarification":{"clarification_id":"test-question","questions":[{"id":"budget","prompt":"确认预算版本","options":[{"value":"annual","label":"年初预算"}]}]}}\n\n' });
  });
  await page.getByRole("button", { name: "经营驾驶舱", exact: true }).click();
  await page.getByRole("button", { name: "智能分析入口", exact: true }).click();
  await page.getByRole('combobox', { name: '分析主体', exact: true }).selectOption('事业部甲');
  await page.getByRole('combobox', { name: '分析期间', exact: true }).selectOption('2026-08');
  await page.getByLabel("向财务分析师提问").fill("查询预算差异");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByRole("button", { name: "提交口径选择并继续" })).toBeDisabled();
  await page.getByLabel("年初预算", { exact: true }).check();
  await page.getByRole("button", { name: "提交口径选择并继续" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "模型服务不可用" })).toBeVisible();
  expect(resumed?.clarification_submit).toEqual({ clarification_id: "test-question", answers: [{ question_id: "budget", choice: "annual" }] });
  expect(resumed?.messages).toEqual([]);
  expect(resumed?.application_context).toEqual({ application_id: "finance" });
  await page.unroute("**/api/application-center/v1/askdata/chat/stream");
  await page.route("**/api/application-center/v1/askdata/chat/stream", route => {
    reportRegistered = true;
    return route.fulfill({ contentType: "text/event-stream", body:
      'event: message_chunk\ndata: {"content":"## 收入分析\\n\\n|收入|预算|\\n|---|---|\\n|42|50|\\n\\n<script>alert(1)</script>"}\n\n' +
      'event: agent_artifacts\ndata: {"artifacts":{"aksdata":{"generated_sql":"SELECT revenue FROM finance_monthly","data_table":{"columns":["revenue"],"rows":[{"revenue":42}]},"dashboard_card":{"url":"/dash/app/test/verified","scene_id":"verified","publish_verified":true,"publish_status":"published"},"report_card":{"url":"/report/app/test/report","title":"测试H5草稿","html_artifact_id":32,"production_artifact_id":456,"registration_status":"registered"}}}}\n\n' });
  });
  let saved: Record<string, unknown> | undefined;
  await page.route("**/api/application-center/v1/askdata/production-artifacts", route => {
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { code: 0, payload: { id: 123, workspace_id: 8 } } });
  });
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page.getByLabel("向财务分析师提问").fill("核对经营预算差异");
  await page.getByRole("button", { name: "发送问题" }).click();
  const technicalQuery = page.getByText("数据依据与高级信息", { exact: true });
  await expect(technicalQuery).toBeVisible();
  await expect(page.getByText("SELECT revenue FROM finance_monthly", { exact: true })).not.toBeVisible();
  await technicalQuery.click();
  await expect(page.getByText("SELECT revenue FROM finance_monthly", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "收入分析", exact: true })).toBeVisible();
  await expect(page.locator('.chat-assistant .rich-text table')).toBeVisible();
  await expect(page.locator('.chat-assistant script')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '预览 H5 报告' })).toHaveAttribute('href', '/report/app/test/report');
  await expect(page.getByText("H5 草稿已登记为财务成果 #456", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "在底座复核成果" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存旧版 H5 成果" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "预览实际看板" })).toHaveAttribute("href", /\/dash\/app\/test\/verified$/);
  await expect(page.getByRole("button", { name: "复核满意并保存看板" })).toBeEnabled();
  await page.getByRole("button", { name: "保存分析依据为成果" }).click();
  await expect(page.getByText("分析依据已保存为平台成果", { exact: true })).toBeVisible();
  expect(saved?.artifact_type).toBe("sql_snippet");
  expect(saved?.payload_ref).toMatchObject({ sql_text: "SELECT revenue FROM finance_monthly" });
  await expect(page.getByText("可在财务成果中心继续使用", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "成果中心", exact: true }).click();
  await expect(page.getByText("成果 #456", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /在底座/ })).toHaveCount(0);
  await page.getByRole('button', { name: '分享快照' }).click();
  await page.getByLabel('我确认快照可供持有链接的外部人员阅读').check();
  await page.getByRole('button', { name: '生成并复制外链' }).click();
  await expect(page.getByLabel('外部分享链接')).toHaveValue(/public-artifact-share#t{43}$/);
  await page.getByRole('button', { name: '关闭分享' }).click();
  expect(artifactListQueries.some(url => url.includes("domain_code=function.finance") && url.includes("page_size=12"))).toBeTruthy();
  await page.getByRole("button", { name: "专业复核", exact: true }).click();
  await page.getByRole("button", { name: "提交复核", exact: true }).click();
  await expect(page.getByText("复核状态：待复核", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "复核并发布" })).toBeEnabled();
  await page.getByRole("button", { name: "查看冻结正文" }).click();
  await page.getByLabel("复核意见").fill("已核对月报口径及证据版本");
  await page.getByRole("button", { name: "复核并发布" }).click();
  await expect(page.getByText("复核状态：已发布", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看冻结正文" }).click();
  await expect(page.locator('iframe[title="报告 456 冻结正文"]')).toHaveAttribute("sandbox", "");
  await expect(page.frameLocator('iframe[title="报告 456 冻结正文"]').getByRole("heading", { name: "冻结月报正文" })).toBeVisible();
  expect(reviewCalls.map(call => call.expected_revision)).toEqual([0, 1]);
  await page.getByRole("button", { name: "经营驾驶舱", exact: true }).click();
  await page.getByRole("button", { name: "智能分析入口", exact: true }).click();
  await page.getByRole('combobox', { name: '分析主体', exact: true }).selectOption('事业部甲');
  await page.getByRole('combobox', { name: '分析期间', exact: true }).selectOption('2026-08');
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByText("数据依据与高级信息", { exact: true })).not.toBeVisible();
  // A cancelled execution is confirmed by the platform, not by aborting fetch.
  await page.getByLabel('向财务分析师提问').fill('核对经营预算差异');
  const runId = 'b'.repeat(32);
  let cancelConfirmed = false;
  let finishPending: (() => void) | undefined;
  await page.unroute("**/api/application-center/v1/askdata/chat/stream");
  const frame = (seq: number, event: string, data: Record<string, unknown>) => `event: ${event}\ndata: ${JSON.stringify({ ...data, _stream: { run_id: runId, seq } })}\n\n`;
  let activeThread = '';
  const continuationBodies: Record<string, unknown>[] = [];
  await page.route("**/api/application-center/v1/askdata/chat/stream", route => {
    const body = route.request().postDataJSON(); continuationBodies.push(body);
    activeThread = body.thread_id;
    return route.fulfill({ contentType: 'text/event-stream', headers: { 'X-Analysis-Run-ID': runId }, body: frame(1, 'stream_started', {}) });
  });
  await page.route(`**/api/application-center/v1/askdata/chat/runs/${runId}/events?*`, async route => {
    if (!cancelConfirmed) await new Promise<void>(resolve => { finishPending = resolve; });
    const prefix = new URL(route.request().url()).searchParams.get('after') === '0' ? frame(1, 'stream_started', {}) : '';
    await route.fulfill({ contentType: 'text/event-stream', body: prefix + frame(2, 'stream_terminal', { status: 'cancelled' }) });
  });
  await page.route(`**/api/application-center/v1/askdata/chat/runs/${runId}/cancel`, async route => {
    expect(route.request().method()).toBe('POST'); cancelConfirmed = true;
    await route.fulfill({ json: { run_id: runId, thread_id: activeThread, status: 'cancel_requested' } });
    finishPending?.();
  });
  await page.route(`**/api/application-center/v1/askdata/chat/runs/${runId}`, route => route.fulfill({ json: {
    run_id: runId, thread_id: activeThread, status: 'cancelled', context: { query: '已恢复的原始预算问题', analysis_scope: { period_start: '2026-08', period_end: '2026-08', entities: ['事业部甲'] }, session_outcome_goals: ['data_analysis'] },
  } }));
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止接收', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消平台执行', exact: true }).click();
  await expect(page.getByText('平台已确认：分析已取消。', { exact: true })).toBeVisible();
  await page.getByLabel('向财务分析师提问', { exact: true }).fill('哪些预算差异仍属于待验证假设？');
  await page.getByRole('button', { name: '继续追问', exact: true }).click();
  await expect(page.getByText('平台已确认：分析已取消。', { exact: true })).toBeVisible();
  expect(continuationBodies.at(-1)?.messages).toEqual([{ role: 'user', content: '哪些预算差异仍属于待验证假设？' }]);
  expect(continuationBodies.at(-1)?.thread_id).toEqual(continuationBodies[0].thread_id);
  expect(cancelConfirmed).toBe(true);
  await page.getByRole('button', { name: '恢复上次分析', exact: true }).click();
  await expect(page.getByText('已恢复的原始预算问题', { exact: true })).toBeVisible();
  await expect(page.getByText('已恢复原会话的问题', { exact: false })).toBeVisible();
  await expect(page.getByText('平台已确认：分析已取消。', { exact: true })).toBeVisible();
  await page.getByText('本次分析范围与成果类型', { exact: false }).click();
  await page.getByRole('combobox', { name: '金额单位', exact: true }).selectOption('millions');
  await expect(page.getByText('业务范围已改变', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续追问', exact: true })).toHaveCount(0);
  let unexpectedGeneration = 0;
  page.on('request', request => { if (request.url().endsWith('/chat/stream')) unexpectedGeneration++; });
  await page.getByRole('combobox', { name: '期望成果', exact: true }).selectOption('report');
  await page.getByLabel('向财务分析师提问').fill('生成本期管理层报告');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请确认报告/看板生成的执行成本' })).toBeVisible();
  expect(unexpectedGeneration).toBe(0);
  await page.getByRole('combobox', { name: '期望成果', exact: true }).selectOption('data_analysis');
  await page.unroute('**/api/application-center/v1/askdata/chat/stream');
  const confirmationRevision = 'c'.repeat(64);
  const confirmations: Record<string, unknown>[] = [];
  await page.route('**/api/application-center/v1/askdata/chat/stream', route => {
    const body = route.request().postDataJSON();
    if (body.analysis_confirmation) {
      confirmations.push(body);
      return route.fulfill({ contentType: 'text/event-stream', body: `event: stream_terminal\ndata: ${JSON.stringify({ status: body.analysis_confirmation.decision === 'approve' ? 'budget_exceeded' : 'cancelled' })}\n\n` });
    }
    return route.fulfill({ contentType: 'text/event-stream', body: `event: interrupt\ndata: ${JSON.stringify({ value: { type: 'analysis_confirmation', revision: confirmationRevision, title: '扩展分析需要确认', summary: '进一步验证两个经营假设' } })}\n\n` });
  });
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.getByRole('button', { name: '拒绝扩展并保留已有结果', exact: true }).click();
  expect(confirmations[0].analysis_confirmation).toEqual({ revision: confirmationRevision, decision: 'reject' });
  expect(confirmations[0].interrupt_feedback).toBeUndefined();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByLabel('向财务分析师提问').fill('继续核验预算差异');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.getByRole('button', { name: '同意本次扩展执行', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '执行预算上限' })).toBeVisible();
  expect(confirmations[1].analysis_confirmation).toEqual({ revision: confirmationRevision, decision: 'approve' });
  // Policy administration now belongs to the base platform, not the finance UI.
  // Backend knowledge-policy tests retain the approval and conflict contracts.
  await expect(page.getByRole('button', { name: '知识运营', exact: true })).toHaveCount(0);
});
