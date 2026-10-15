# Vue3 Monorepo 通用后台模板

> NestJS 11 + Vue 3 + Element Plus + Vant 4 + TypeScript 全栈模板，开箱即用，支持一键 Docker 部署。

## ✨ 核心特性

- **后端**：NestJS 11 + TypeORM + MySQL 8 + Redis 7，模块化分层设计
- **Admin 后台**：Vue 3 + Vite 8 + Element Plus + Pinia + Vue Router 4
- **App 移动端**：Vue 3 + Vite 8 + Vant 4（移动端 H5）
- **RBAC 权限体系**：角色 / 权限码 / 用户角色 / 角色权限，多维度控制
- **JWT 双 Token**：Access + Refresh + HttpOnly Cookie + 多设备会话
- **登录风控**：IP 滑动窗口限流 + 账号失败计数 + 自动锁定
- **统一响应格式**：成功 `{ code: 0, msg, data }`／失败 `{ code, msg, data, requestId, timestamp }`，前端按 `code === 0` 判定
- **全局异常过滤器**：catch Everything，附带 requestId 链路追踪
- **结构化日志**：Winston + nest-winston，控制台 + JSON 文件双输出
- **健康检查**：liveness + readiness 双端点，K8s / Docker HEALTHCHECK 可用
- **安全防护**：Helmet 安全头、CORS 白名单、参数白名单校验、SQL 防注入（TypeORM）
- **Docker 化**：多阶段构建 + docker-compose 一键启动整套生产环境

## 📁 项目结构

```
vue3-monorepo/
├── packages/
│   ├── shared/         # 前后端共享类型 / 常量
│   ├── server/         # NestJS 后端
│   ├── admin/          # Vue3 后台
│   └── app/            # Vue3 移动端 H5
├── deploy/
│   └── nginx/          # 前端 nginx 配置
├── logs/               # 后端日志（运行时生成）
├── docker-compose.yml    # 一键编排
├── Dockerfile.server   # 后端镜像
├── Dockerfile.admin    # Admin 前端镜像
├── Dockerfile.app      # App 前端镜像
├── .env.example        # Docker Compose 环境变量样例（根目录 .env）
└── packages/server/.env.example  # 后端进程环境变量样例（packages/server/.env）
```

## 🚀 快速开始

### 方式一：Docker 一键启动（推荐生产环境）

```bash
# 1. 准备环境变量
cp .env.example .env
# 修改 JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / DB_PWD / REDIS_PASSWORD / MYSQL_ROOT_PASSWORD
# 生成随机密钥（两个 JWT 密钥**必须不同**）：
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 2. 预建挂载目录并改属主（Linux/macOS 必做，见下方说明）
mkdir -p ./logs/backend ./uploads/backend
sudo chown -R 1001:1001 ./logs/backend ./uploads/backend

# 3. 一键启动（构建镜像 + 启动容器）
docker compose up -d --build

# 4. 查看启动日志
docker compose logs -f backend

# 5. 访问
#   Admin:    http://localhost:8080
#   App H5:   http://localhost:8081
#   API:      http://localhost:3000
#   健康检查: http://localhost:3000/health
#   注意 Swagger（/api-docs）在生产环境是关闭的，见下方说明

# 6. 停止
docker compose down

# 7. 完全清理（含数据卷）
docker compose down -v
```

**部署清单（上线前逐项确认）**

| 项 | 为什么 |
|---|---|
| `.env` 里的 5 个密钥都已改成随机值 | 仓库里的默认值公开可查。带着占位密钥上线等于把 JWT 签名密钥公开 —— 任何人都能自签管理员令牌 |
| `ALLOW_INSECURE_DEFAULTS` **未设置或为 false** | 这是跳过启动期密钥自检的逃生舱。它默认关闭；**保持关闭**，让配错的密钥在启动时就暴露，而不是等被利用时才发现 |
| `./logs/backend`、`./uploads/backend` 已 `mkdir` 且 `chown 1001:1001` | 容器内以非 root 的 `nestjs`(uid 1001) 运行。若由 Docker 以 root 创建这两个目录，日志写不进、上传报 EACCES —— 启动阶段**不报错**，上线后第一次上传才炸 |
| `DB_NAME` 保持 `vue3_monorepo` | 初始化脚本 `nest-db.sql` 里的库名是硬编码的。改了名字会建出一个空库，14 张表依旧建进原库，后端连上空库 |
| 短信：`SMS_MOCK` 按需设置 | 阿里云 SDK 尚未接入，`production` 下真实通道固定返回 503，即「忘记密码 / 短信登录」不可用。临时办法是设 `SMS_MOCK=true`，验证码写入 `./logs/backend` 由运维取；正式上线请接入 SDK |
| 已规划数据库备份 | 仓库只提供 `mysql_data` 命名卷，**没有**备份脚本。`nest-db.sql` 含 `DROP TABLE`，不要在已有数据的环境重跑 |

> **Linux 上的目录权限**：`docker compose up` 时若 `./logs/backend` / `./uploads/backend` 不存在，Docker daemon 会以 root 创建它们（属主 root:root、权限 755），容器内的 `nestjs` 用户随即失去写权限。这一步只在首次部署时需要，之后目录已存在就不会被重建。
>
> **Swagger**：`main.ts` 只在非生产环境挂载 `/api-docs`。compose 里 `NODE_ENV=production`，所以该地址在生产是 404 —— 需要接口文档请用「方式二」在本地起后端。

### 方式二：本地开发

```bash
# 1. 安装依赖（需要 pnpm >= 10）
pnpm install

# 2. 启动共享包（一次性）
pnpm build:shared

# 3. 准备数据库（确保 MySQL 已运行）
#    在 MySQL 中执行 packages/server/nest-db.sql

# 4. 配置 packages/server/.env
#    cp packages/server/.env.example packages/server/.env
#    ⚠️ 用 packages/server/.env.example，不是根目录那个 .env.example：
#       根目录的是给 docker compose 用的，里面没有 DB_HOST / LOCAL_UPLOAD_BASE_DIR 等
#       后端必需项，复制成 server/.env 会启动即报「环境变量 DB_HOST 未在 .env 中配置」。
#    缺失会直接启动失败（无代码兜底）的变量：
#    DB_HOST  DB_PORT  DB_USER  DB_PWD  DB_NAME
#    JWT_ACCESS_SECRET  JWT_REFRESH_SECRET  CORS_ORIGINS
#    LOCAL_UPLOAD_BASE_DIR  LOCAL_STATIC_PREFIX
#    其余常用项（REDIS_* / LLM_TYPE / STORAGE_TYPE / APP_PORT 等）都有默认值，
#    逐项说明见该模板文件内的注释。

# 5. 启动开发服务
pnpm dev:full    # 同时启动 server + admin + app
# 或分别启动
pnpm dev:server  # 后端（localhost:3000）
pnpm dev:admin   # Admin 前端（localhost:5175）
pnpm dev:app     # App 前端（localhost:5173）

# 6. 局域网访问
#    把 5173/5175/3000 后面的 localhost 换成你的 LAN IP（如 192.168.1.x）
#    （改用其他端口时，记得同步 backend 的 CORS_ORIGINS 白名单）
#    vite.config.ts 已配置 host:true，自动绑定 0.0.0.0
```

## 🛠️ 常用命令

```bash
# 构建
pnpm build:all           # 构建 shared + admin + app（不含 server，server 见下）
pnpm build:shared        # 只构建共享包
pnpm build:server        # 只构建后端

# 测试
pnpm test                # 运行所有单元测试
pnpm --filter @project/server test:cov    # 后端覆盖率报告

# 代码质量
pnpm lint                # ESLint 检查 + 自动修复
pnpm type-check          # TypeScript 类型检查

# 清理
pnpm clean               # 清理所有 dist / node_modules
```

## 🏗️ 架构设计

### 后端模块

```
src/
├── main.ts                       # 应用入口（中间件/管道/过滤器装配）
├── app.module.ts                 # 根模块
├── common/                       # 通用基础设施
│   ├── enums/business-code.enum.ts    # 统一业务码
│   ├── exceptions/business.exception.ts # 业务异常基类
│   ├── filters/global-exception.filter.ts # 全局异常过滤器
│   ├── interceptors/             # 全局拦截器
│   └── logger/winston.config.ts  # 日志配置
├── modules/
│   ├── auth/                     # 鉴权（登录风控 + 多设备会话）
│   ├── user/                     # 用户模块
│   ├── rbac/                     # RBAC（@Global）
│   ├── admin/                    # 管理后台 API
│   │   ├── role/
│   │   ├── permission/
│   │   ├── user-role/
│   │   ├── audit/                # 审计日志
│   │   └── dashboard/            # 仪表盘统计
│   ├── audit/                    # 审计基础模块
│   ├── redis/                    # Redis 服务封装
│   ├── health/                   # 健康检查
│   ├── account_book/             # 账本业务
│   ├── file/                     # 文件上传/OSS
│   ├── ai/                       # AI 集成
│   ├── chat/                     # 聊天
│   └── sms/                      # 短信验证码
└── config/configuration.ts       # 环境变量配置
```

### 权限体系（RBAC）

```
sys_user          ←── sys_user_role ──→ sys_role
                                          │
                                          ↓
                                   sys_role_permission
                                          │
                                          ↓
                                    sys_permission
```

- `sys_user`：用户表
- `sys_role`：角色（admin / editor / user）
- `sys_permission`：权限码（如 `user:list` / `book:create`）
- `sys_user_role`：用户 ↔ 角色（多对多）
- `sys_role_permission`：角色 ↔ 权限（多对多）

权限校验流程：
1. 请求 → `JwtAuthGuard` 验证 JWT + 黑名单检查
2. → `PermissionsGuard` 检查 `@Permissions('user:list')` 装饰器
3. → 从 Redis 缓存读用户权限码（无缓存则查 DB 并写入）
4. → 命中即放行，否则 403

### 统一响应格式

```typescript
// 成功 —— 由 TransformInterceptor 包装，注意**没有** requestId / timestamp
{
  code: 0,
  msg: '请求成功',
  data: { ... }
}

// 业务错误 —— 由 GlobalExceptionFilter 包装，比成功多两个排查字段
{
  code: 10001,        // BusinessCode.PARAM_INVALID
  msg: '参数不能为空',
  data: { errors: ['字段 xxx 不能为空'] },
  requestId: 'req_xxx',   // 同时透出在响应头 X-Request-Id
  timestamp: 1725000000000
}
```

前端只需判断 `code === 0` 即可。

两个补充：
- 成功响应里 `requestId` 是**不存在的**，不要在前端按它做链路追踪；
  需要追踪请在请求头带 `X-Request-Id`，异常响应会原样回显（见 getOrGenRequestId）。
- HTTP 状态码与 `code` 是两套体系：`code` 取 `BusinessCode` 枚举值（形如 1xxxxx / 2xxxxx），
  与 HTTP status 并非一一对应；内置 `HttpException` 未显式指定业务码时统一落到
  `20000 INTERNAL_ERROR`（见 global-exception.filter.ts 的分支处理）。

### 日志格式

```
# 控制台（开发友好，带颜色；上下文取自 new Logger(X.name)）
[NestApp] [Nest] 28676  - 2026/08/28 10:00:00     WARN [JwtAuthGuard] [Auth] 黑名单检查失败: connection is closed

# logs/app-YYYY-MM-DD.log（JSON 结构化）
{
  "level": "warn",
  "message": "[Auth] 黑名单检查失败: connection is closed",
  "context": "JwtAuthGuard",
  "timestamp": "2026-08-28 10:00:00.123",
  "service": "nest-app",
  "env": "production"
}

# logs/error-YYYY-MM-DD.log（仅 error 级别，供告警系统采集）
```

> ⚠️ 文件名里的 `YYYY-MM-DD` 是**进程启动那天**，不是滚动日期：用的是
> `winston.transports.File` 而非 `DailyRotateFile`，实际切割只按大小（20MB × 14 个文件）。
> 长期不重启的进程会一直写同一个文件，排查时别把它当「当天日志」。

### 健康检查

| 端点 | 用途 | 检查项 |
|------|------|--------|
| `GET /health` | 存活探针（liveness） | 进程是否运行 |
| `GET /health/ready` | 就绪探针（readiness） | DB + Redis 是否可用 |

K8s 配置示例：
```yaml
livenessProbe:
  httpGet: { path: /health, port: 3000 }
  initialDelaySeconds: 30
  periodSeconds: 10
readinessProbe:
  httpGet: { path: /health/ready, port: 3000 }
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 3
```

## 🔐 安全实践

- ✅ 所有密码 bcrypt 哈希（saltRounds=10）
- ✅ JWT 双 Token（Access 15min + Refresh 7d）
- ✅ RefreshToken 一次性轮换（防重放）
- ✅ 多设备登录 + 单设备踢下线（基于 Redis Hash）
- ✅ 登录失败 5 次自动锁定 15 分钟
- ✅ IP 滑动窗口限流（10s / 5 次）
- ✅ Helmet 安全头（X-Frame-Options / X-Content-Type-Options / CSP）
- ✅ CORS 白名单（生产严格，dev 允许 LAN IP）
- ✅ ValidationPipe + whitelist + forbidNonWhitelisted
- ✅ 全局异常过滤器不暴露堆栈给前端
- ✅ Docker 容器以非 root 用户运行
- ✅ Docker HEALTHCHECK 自动剔除异常实例

## 🚢 部署清单（生产环境）

### 必须修改的配置

| 配置项 | 说明 | 建议 |
|--------|------|------|
| `JWT_ACCESS_SECRET` | Access Token 签名密钥 | 32+ 字符随机字符串 |
| `JWT_REFRESH_SECRET` | Refresh Token 签名密钥 | 与 Access 不同 |
| `MYSQL_ROOT_PASSWORD` | MySQL root 密码 | 16+ 字符，包含大小写数字符号 |
| `DB_PWD` | 应用数据库密码 | 同上 |
| `REDIS_PASSWORD` | Redis 密码 | 同上 |
| `CORS_ORIGINS` | 跨域白名单 | 仅包含你的域名 |
| `OSS_*` | 阿里云 OSS（若使用） | 单独子账号 + 只读/上传权限 |

### 部署前检查

- [ ] 修改所有默认密码（两个 JWT 密钥必须不同）
- [ ] `ALLOW_INSECURE_DEFAULTS` 保持未设置或 `false`（不要跳过启动期密钥自检）
- [ ] `mkdir -p ./logs/backend ./uploads/backend && chown -R 1001:1001`（否则上传静默失败）
- [ ] `DB_NAME` 保持 `vue3_monorepo`（`nest-db.sql` 里库名硬编码）
- [ ] `NODE_ENV=production`
- [ ] 检查 `synchronize: false`（TypeORM 不自动改生产库）
- [ ] 关闭 Swagger（自动：生产环境不挂载）
- [ ] MySQL / Redis 端口只绑 `127.0.0.1`（compose 默认已是）
- [ ] 短信：接入 SDK 后保持 `SMS_MOCK=false`；未接入则该功能不可用
- [ ] 配置 HTTPS（推荐前置 Nginx + Let's Encrypt）
- [ ] 配置日志收集（Filebeat / Promtail → ELK / Loki）
- [ ] 配置监控告警（/health 探针 + 错误日志触发）
- [ ] 数据库备份策略（每日 mysqldump）—— 仓库**未提供**备份脚本，需自行编写

### 扩容建议

- 后端无状态，多实例部署（Nginx upstream 负载均衡）
  - ⚠️ 有**两处进程内状态**需要在扩容前先改掉，否则多实例行为不一致：
    1. RBAC 的 L1 缓存是每个进程各自一份的 `Map`。踢下线 / 改角色 / 禁用用户时，
       只有处理该请求的实例会清缓存，其余实例仍持有旧权限直到自身 TTL（约 10 分钟）到期
       —— 表现为「同一次强制下线，一半请求立刻 403、一半继续放行」。
       修法是改用 Redis pub/sub 广播失效，或把 L1 TTL 压到秒级。
    2. 审计日志清理 cron 的 `running` 标志只在单进程内有效，
       每个实例都会在凌晨 3 点各跑一遍（按主键删除所以幂等，但日志计数会翻倍、
       `sys_audit_log` 上会多出成倍的锁竞争）。修法是换成 Redis `SETNX` 分布式锁。
- MySQL 主从 + 读写分离
- Redis Cluster（多设备会话可分片）
- 日志目录挂载共享存储（避免容器重启丢失）
- 前端静态资源 CDN 加速

## 🧪 测试

```bash
# 单元测试
pnpm test

# 覆盖率报告
pnpm --filter @project/server test:cov

# 当前单测（服务端 14 个 spec）
# - common/:  GlobalExceptionFilter / RefreshTokenGuard
#             client-ip.util / pagination.util / random-filename.util / token-version.util
# - config/:  production-env.util
# - modules/: LoginThrottlerService / SessionService / ChatGateway / ChatService
#             RbacService / SmsService / UserCrudService
# 前端：shared 有 vitest（auth-storage / token-refresh），admin / app 暂无单测
#
# ⚠️ CI 目前只跑 `--filter @project/server test`，shared 的两个用例不会执行。
#    本地验证前端请显式跑：pnpm --filter @project/shared test
```

## 📝 开发规范

- TypeScript 严格模式（strictNullChecks: true）
- ESLint + Prettier 自动格式化
- 注释规范：JSDoc 中文注释，便于团队协作
- 模块边界：每个模块一个文件夹，含 `entities/` / `dto/` / `*.controller.ts` / `*.service.ts` / `*.module.ts`
- 命名：文件名 kebab-case，类名 PascalCase，变量 camelCase
- 提交规范：`feat: xxx` / `fix: xxx` / `docs: xxx` / `refactor: xxx`

## 📄 License

MIT

---

**提问 / Bug 反馈**：提交 Issue 或联系 [liwei@example.com](mailto:liwei@example.com)