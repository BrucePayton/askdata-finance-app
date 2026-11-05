# 财务版部署、备份与 DSC 回滚（S32）

## 隔离边界

只使用 `deployments/deployment_finance/.env`、`.env.example`、`compose.yaml` 和 `deploy-finance.sh`。
Compose 项目固定 `askdata-finance-platform`；Dify / 模型也有独立 finance 项目；网络和数据卷带财务项目前缀。
主入口端口 18080；新增 capabilities 只在 finance-net 暴露内部 5630，没有宿主端口。
基础初始化 SQL、Keycloak 种子和 PostgreSQL 配置目前作为底座只读资产引用，不能在财务升级中修改通用副本。
迁移必须保持 `ALLOW_DESTRUCTIVE_DB_INIT=0`、preserve 模式，不能通过升级重新清空底座。

## 升级前

在仓库根目录使用 Python（需项目已有 python-dotenv）：

```bash
python deployments/deployment_finance/scripts/finance-release.py capture \
  --deployment-dir /absolute/repository/deployments/deployment_finance \
  --manifest /absolute/repository/deployments/deployment_finance/backups/before.json --backup
python deployments/deployment_finance/scripts/finance-release.py backup-config \
  --deployment-dir /absolute/repository/deployments/deployment_finance \
  --manifest /absolute/repository/deployments/deployment_finance/backups/before.json
```

工具固定四个 DSC 仓库，记录 image ID / RepoDigest，并给旧镜像增加统一时间戳保留标签，避免新构建覆盖后无法定位。
备份平台 PostgreSQL、Dify PostgreSQL、向量 PostgreSQL、DSC Mongo、财务 MySQL；MySQL 使用本地已配置只读账号及单事务快照，不读取随机 root 密码。
备份目录权限 0700，文件 0600，全部位于 git 忽略的 finance/backups。配置备份包含敏感值，禁止提交或打印；发布清单只有 hash，不含密码。
每份备份有大小及 SHA-256；失败且未纳入成功清单的部分文件不能当成有效备份。
清单还记录全部财务运行实例镜像、网络、端口和卷映射，供底座最终构建后统一发布存档。

## 本地构建和验证

```bash
bash deployments/deployment_finance/scripts/build-dsc-local.sh /absolute/path/to/data_supply_chain finance-local
bash deployments/deployment_finance/deploy-finance.sh up -d --no-deps --no-build --pull never dsc-backend dsc-frontend dsc-capabilities
```

四个 DSC 镜像必须全部使用 `finance-local`：app、frontend、python-sandbox、capabilities。
Sandbox 是按需短生命周期执行镜像，不应伪造一个常驻容器来显示健康。
检查三个服务 healthy，并在禁止网络、只读根文件系统、无 capabilities、受限 PID/CPU/内存条件下执行 sandbox 简单计算。
随后执行 `check-finance-knowledge.py` 和 `check-report-review.py`，确认真实文档、政策版本和发布成果仍可读取。

## 有界文档处理服务接入

财务私有配置 `DSC_DOCUMENT_PROCESSING_URL=http://dsc-capabilities:5630`；API key 只留在本地 `.env`。
知识版本创建对真实已索引预处理文本调用 V2 `/api/v2/document-processing/extractions`，核对响应身份及原文 SHA，记录块数、块 ID 和解析版本。
该服务参与实际知识治理入库，而非仅健康展示。UUIDv5 是平台数字 workspace 和规范文档 ID 的传输别名，不创建租户或资源副本。
未配置该环境变量的通用部署继续旧流程。显式配置后解析服务不可用则停止版本创建，不能假装成功。
它补充知识版本结构验证；并不声称已替换全部旧版 DSC 上传/向量化接口。

## 镜像回滚与向前恢复

先为新版本再 capture 一份 `after.json`；以下命令恢复清单中的四个 DSC image ID：

```bash
python deployments/deployment_finance/scripts/finance-release.py restore \
  --deployment-dir /absolute/repository/deployments/deployment_finance \
  --manifest /absolute/repository/deployments/deployment_finance/backups/before.json
```

严格限定三个 DSC 服务，使用 `--no-deps --no-build --pull never`。不删除容器卷、不恢复数据库、不触碰通用服务，也不暗中回退底座后端。
本次属于兼容协议的镜像回滚，运行配置保留当前版本；若协议不兼容，维护者须审阅私有 env 备份，仅回退相关配置并协调底座重启，不能整份覆盖后续新增配置。
重复健康、知识和报告检查后，使用 `after.json` 同命令向前恢复，再次验证。
数据库恢复不是镜像回滚的一部分；需要单独维护窗口和明确批准，不能自动将升级后新增成果覆盖掉。

## 2026-09-09 实际验收记录

DSC 来源提交：`6aafeb1dea70d8cf4e8cab6871e5829b91818be2`，构建前后工作树干净，没有改动 DSC 源码。

| 镜像（统一 finance-local） | 新 image ID / digest |
| --- | --- |
| data-supply-chain-app | `sha256:0e2865a5da90082c22cb813efdfae90c90ae0cb2be0f6030578a94e4d9adff01` |
| data-supply-chain-frontend | `sha256:32975316cfd140b80589db1c3567484a55eaffa5396920168833b57a641b945e` |
| dsc-python-sandbox | `sha256:bcf51f0806bb0a83e3824652b2bfc60c408625644c28bb2d7c82e010ce1eecad` |
| data-supply-chain-capabilities | `sha256:513d68ce4bc29143e755a927e9fb6de6531d14bd5c01f701a0c852312b0300d7` |

已执行新镜像部署 → 旧四镜像回滚 → 新镜像恢复，三个服务各阶段均 healthy。
知识政策 7–12 保持完整；两端检索/有效期验证均通过。发布报告 13–15 的复核快照返回 200，历史草稿 2/4/5 保留。
69 份通用部署文件（含私有 env 的 hash）不变。基线没有非财务运行实例，因此没有虚称完成一个不存在的通用运行环境的功能测试。
真实 V2 调用返回 schema_version=2.0、1 个内容块且身份/hash 匹配；sandbox 无网络只读计算通过。
底座部署接入代码后，经共享政策创建入口重新运行六份测试文档治理入库：2026-09-09 08:37:29 UTC 的 capabilities 访问记录为六次 V2 extraction POST，全部 HTTP 200。
幂等结果仍为政策 7–12、version 1、approved；没有新增重叠版本。随后只读验收确认两个入口返回同六份政策，8 月检索获得 3 条已复核内容，9 月排除过期政策 7/8/9/11 并保留 1 条有效内容。
上述 approved 仅是显式 `--approve-test` 的技术测试复核，不代表企业财务负责人正式批准。
私有发布记录：`backups/release-before-dsc-20260909.json`、`backups/release-after-dsc-20260909.json`。

### 最终底座与双前端发布清单

最后业务代码基准 `bc52a671`（含真实报告路由、领域上下文保留、确定性 DSC 读取预算和运行计时），2026-09-09 完成本地构建并部署。
运行容器实际 Image 标识如下（Docker manifest/index 标识，不能与 config digest 混称）：

| 镜像（finance-local） | 运行 Image |
| --- | --- |
| askdata-finance-backend | `sha256:e6dd472a9ab25b63dd3089601b58f37c5c21ffba6a56d04fbf799204aae30819` |
| askdata-finance-platform-web | `sha256:c01e3921b816289523d93499461e2fc61cbef4302427162d22e45b655598a641` |
| askdata-finance-web | `sha256:f9663907c94d0641f3d11a4a191b37c0e43983ceb90e31dfb18e0ac807442ef4` |

全体财务实例（含依赖）的镜像、网络、端口、卷和当时健康状态已保存在私有 `backups/release-final-20260909.json`；SHA-256 为 `edd8437192b885c021d4be32a5c16dcc6efa274eb709f33b754d6457bdaa6bdb`。清单记录的 Git HEAD 包含文档提交，业务代码以本段基准为准。
对 before 与 final 执行 verify 均通过：69 份通用部署文件与基线一致，已有备份校验正确。DSC 四镜像与上表 DSC 记录一致，统一 tag 未变。
底座、双前端、DSC 三服务均 healthy；双入口登录/真实数据库/资源浏览器回归 3 项通过；知识只读复验仍为政策 7–12、8 月 3 条、9 月 1 条且过期政策排除。
启动窗口内一次浏览器运行出现登录失败，健康后完整复跑 3 项通过；没有将启动中失败隐藏为通过。
本次只更新财务服务，没有恢复数据库，也没有删除历史草稿或重置通用环境。

认证新建/注销会话日志已改为不可逆短 hash，不再输出 JWT；旧运行日志可能含修复前令牌，需要维护者按保留策略审阅和轮换，未擅自删除历史日志。

### 附件权限收尾后的最终镜像（取代上述中间发布）

业务代码基准 `453dd78a`；最终 backend 运行 Image 为 `sha256:3a4d18e91acd216d4a35db6a42c075fb0717338bbd3cd93f820f795405df5795`。双前端与 DSC 镜像不变。
新的最终私有清单为 `backups/release-final-secure-20260909.json`，SHA-256 `16d21d781009114da3b09eead1371e5acfabce0aab3c4543eba2132545210941`，verify 通过；旧清单保留作为中间发布记录。
健康后实机负例检查：匿名上传401，专业入口未验证归属附件（legacy/v1）均403，未创建分析run；六份知识政策与八份报告双端一致，发布快照13–15仍200，16/17保持草稿。详见 `scripts/check-attachment-boundary.py`。
报告实际生成与计时验收发生在前一镜像，最后九行生产变更仅为上述入口授权；最终镜像执行完整定向202项回归、4个subtests通过，并只读重验既有报告，未再次生成报告。
