# 衡策 · 财务智能分析中心

独立 React / TypeScript / Vite 财务前端，不覆盖原 `web/` 工程。
部署见 [财务版部署说明](../deployments/deployment_finance/README.md)，配置只使用该目录的私有 `.env`。

## 运行

部署入口：`http://localhost:18080/finance/`。使用独立平台账号登录。
财务数据库另要求用户 ID 位于服务端 `FINANCE_ALLOWED_USER_IDS` 中。
令牌仅驻留页面内存，不保存到浏览器存储。

开发执行 `npm ci`、`npm run dev`，API 默认代理独立平台 `127.0.0.1:18080`。
可用 `FINANCE_API_TARGET` / `PLATFORM_API_TARGET` 覆盖。
`npm run build` 只生成本工程 `dist/`。

## 功能与依赖

- 工作台和六类财务分析通过平台查询 MySQL，以 Decimal 计算指标。
- 数据与连接：登录、工作空间、测试和注册数据源、挂载资源。
- 知识运营：知识库创建、上传预处理、索引和检索，依赖 DSC 与 Dify。
- 智能分析：真实流式问数、知识问答、看板、H5 报告任务及执行确认。
- 报告中心读取平台持久化成果；本地 Markdown 草稿不是模型生成的 H5 报告。
- 分析资产包含指标、Skill、SQL、MCP；见 `assets/finance/mcp-config.json`。

模型任务需要可用模型配置及已挂载资源；错误直接展示，不用静态答案替代。

## 数据边界

开发管理账按本次要求拟定后入库，并非企业生产账簿；初始化源为
`deployments/deployment_finance/finance/init/01-finance.sql`。
前端不内置财务数字或模拟模式。替换数据需修改财务版配置及
`assets/finance/mysql-mapping.json`，缺失字段不得填零。

应收为单日快照，历史期间不复用；经营利润为管理口径，多主体未作合并抵销，
杜邦未年化，报告需财会人员复核。目前不提供主体级行权限。

## 验证

执行 `npm run build` 与 `npm run test:e2e`。
集成测试可配置 `FINANCE_E2E_BASE_URL=http://localhost:18080/finance/`、
`FINANCE_E2E_USERNAME`、`FINANCE_E2E_PASSWORD`；凭据不得入仓。
协议测试夹具仅用于测试，不参与运行时展示。
