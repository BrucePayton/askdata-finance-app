# AskData Finance App

通用财务分析应用，作为独立应用项目连接兼容 `domain_application/v1` 和 `platform_contract: v1` 的底座平台。

本仓库只包含财务领域能力：独立 React 前端、确定性计算引擎、只读 MCP、应用清单、知识/SQL 资产和领域测试。身份、工作空间、权限、问数执行、成果治理与持久化由底座平台提供，应用不复制这些能力。

## 本地开发

前端：

```bash
cd frontend
npm ci
PLATFORM_API_TARGET=http://127.0.0.1:18080 npm run dev
```

领域引擎与测试：

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
pytest
```

配置数据库时复制 `.env.example` 为 `.env`。运行时只接受服务端数据库配置；浏览器请求不能提交 SQL、连接串或凭据。

## 测试数据

`test-data/finance-demo.sql` 和 `tests/finance/fixtures/golden-v2.json` 是合成演示数据与固定预期，不包含真实企业、个人或客户账务。可用于本地初始化和回归测试，不得将其解释为生产财务结论。

## 接入底座

- 应用合同：`assets/domain-applications/finance/manifest.json`
- 前端 API：同源 `/api/application-center/v1/.../applications/finance`
- 可选独立引擎：`python -m core.modules.finance.server`
- 可选 MCP：`python -m core.modules.finance.mcp_server`
- 容器叠加：`docker build --build-arg PLATFORM_IMAGE=<immutable-platform-image> -f deploy/backend-overlay.Dockerfile .`

`PLATFORM_IMAGE` 应固定为不可变摘要。平台负责审核并注册清单；本仓库不会动态注入 Python 模块路径。

完整的 Compose、网关、升级及回退规范见 [`deployment/README.md`](deployment/README.md)。

## 数据与安全边界

- 数据源账户必须是只读账户，查询使用固定映射和有界读取。
- 示例配置不包含真实凭据；不要提交 `.env`、数据库导出或客户数据。
- 财务结论需要专业人员复核；内置资产不是审计意见。

## License

Apache-2.0，见 `LICENSE`。
