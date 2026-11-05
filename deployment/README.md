# 财务应用部署规范

本规范从原 `feature/finance-analysis-center` 财务部署中抽取，只部署应用层，不复制 PostgreSQL、Redis、Keycloak、Dify、DSC、成果服务等底座组件。

## 前置条件

- 已运行兼容 `platform_contract: v1` 的底座平台。
- 平台已安装 `assets/domain-applications/finance/manifest.json` 并完成知识库、只读数据库绑定。
- 平台应用接口可由 `PLATFORM_API_URL` 访问。
- 生产环境使用不可变镜像摘要，数据库账号仅授予 `SELECT`。

## 构建应用后端叠加镜像

```bash
docker build \
  --build-arg PLATFORM_IMAGE='registry.example/platform@sha256:<digest>' \
  -f deploy/backend-overlay.Dockerfile \
  -t registry.example/askdata-finance-app-backend:2.0.0 .
```

将生成的镜像作为底座后端及应用 worker 的发布镜像。平台数据库迁移、worker 注册和应用清单安装仍由平台运维流程执行。

## 启动前端与窄边界网关

```bash
cd deployment
cp .env.example .env
# 编辑 .env；PLATFORM_API_URL 指向底座 API
sh deploy.sh config
sh deploy.sh build
sh deploy.sh up -d --no-build
sh deploy.sh ps
```

默认仅监听 `127.0.0.1:18081`，入口为 `/finance/`。生产发布应在外层 TLS 网关配置域名、证书、访问日志脱敏和速率限制。

## 升级与回退

1. 备份底座应用任务表、成果表及业务数据库；记录当前不可变镜像摘要。
2. 构建并验证新叠加镜像和前端镜像。
3. 先执行平台要求的 schema job，再滚动更新后端、worker 和前端。
4. 验证登录、context、固定分析运行、报告复核和跨空间拒绝。
5. 回退时恢复旧镜像摘要；不删除卷、不回滚已生成成果。

`.env`、数据库备份、报告产物和运行日志不得提交 Git。原分支完整底座发布记录保存在 `docs/source-branch-release-runbook.md`，其中的旧路径仅作迁移追溯。
