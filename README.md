# Vue3 Monorepo 通用后台模板

> NestJS 11 + Vue 3 + Element Plus + Vant 5 + TypeScript 全栈模板，开箱即用，支持一键 Docker 部署。

## ✨ 核心特性

- **后端**：NestJS 11 + TypeORM + MySQL 8 + Redis 7，模块化分层设计
- **Admin 后台**：Vue 3 + Vite 8 + Element Plus + Pinia + Vue Router 4
- **App 移动端**：Vue 3 + Vite 8 + Vant 5（移动端 H5）
- **RBAC 权限体系**：角色 / 权限码 / 用户角色 / 角色权限，多维度控制
- **JWT 双 Token**：Access + Refresh + HttpOnly Cookie + 多设备会话
- **登录风控**：IP 滑动窗口限流 + 账号失败计数 + 自动锁定
- **统一响应格式**：`{ code, msg, data, requestId, timestamp }`，前端可统一拦截
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
└── .env.example        # 环境变量样例
```

## 🚀 快速开始

### 方式一：Docker 一键启动（推荐生产环境）

```bash
# 1. 准备环境变量
cp .env.example .env
# 修改 JWT_SECRET、密码等敏感配置

# 2. 一键启动（构建镜像 + 启动容器）
docker compose up -d --build

# 3. 查看启动日志
docker compose logs -f backend

# 4. 访问
#   Admin:    http://localhost:8080
#   App H5:   http://localhost:8081
#   API:      http://localhost:3000
#   Swagger:  http://localhost:3000/api-docs
#   健康检查: http://localhost:3000/health

# 5. 停止
docker compose down

# 6. 完全清理（含数据卷）
docker compose down -v
```

### 方式二：本地开发

```bash
# 1. 安装依赖（需要 pnpm >= 10）
pnpm install

# 2. 启动共享包（一次性）
pnpm build:shared

# 3. 准备数据库（确保 MySQL 已运行）
#    在 MySQL 中执行 packages/server/nest-db.sql

# 4. 配置 packages/server/.env
#    参考 .env.example，关键配置：
#    DB_HOST=localhost  DB_PORT=3306  DB_USER=xxx  DB_PWD=xxx  DB_NAME=vue3_monorepo
#    REDIS_HOST=localhost  REDIS_PORT=6379  REDIS_PASSWORD=xxx
#    JWT_ACCESS_SECRET=xxx  JWT_REFRESH_SECRET=xxx

# 5. 启动开发服务
pnpm dev:full    # 同时启动 server + admin + app
# 或分别启动
pnpm dev:server  # 后端（localhost:3000）
pnpm dev:admin   # Admin 前端（localhost:5173）
pnpm dev:app     # App 前端（localhost:5174）

# 6. 局域网访问
#    把 5173/5174/3000 后面的 localhost 换成你的 LAN IP（如 192.168.1.x）
#    vite.config.ts 已配置 host:true，自动绑定 0.0.0.0
```

## 🛠️ 常用命令

```bash
# 构建
pnpm build:all           # 构建 shared + server + admin + app
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
// 成功
{
  code: 0,
  msg: 'success',
  data: { ... },
  requestId: 'req_xxx',
  timestamp: 1725000000000
}

// 业务错误
{
  code: 10001,        // BusinessCode.PARAM_INVALID
  msg: '参数不能为空',
  data: { errors: ['字段 xxx 不能为空'] },
  requestId: 'req_xxx',
  timestamp: 1725000000000
}
```

前端只需判断 `code === 0` 即可。

### 日志格式

```
# 控制台（开发友好，带颜色）
[NestApp] [Nest] 28676  - 2026/08/28 10:00:00     LOG [UserService] 用户登录成功

# logs/app-YYYY-MM-DD.log（JSON 结构化）
{
  "level": "info",
  "message": "用户登录成功",
  "timestamp": "2026-08-28 10:00:00.123",
  "service": "nest-app",
  "env": "production"
}

# logs/error-YYYY-MM-DD.log（仅 error 级别，供告警系统采集）
```

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

- [ ] 修改所有默认密码
- [ ] `NODE_ENV=production`
- [ ] 检查 `synchronize: false`（TypeORM 不自动改生产库）
- [ ] 关闭 Swagger（自动：生产环境不挂载）
- [ ] 配置 HTTPS（推荐前置 Nginx + Let's Encrypt）
- [ ] 配置日志收集（Filebeat / Promtail → ELK / Loki）
- [ ] 配置监控告警（/health 探针 + 错误日志触发）
- [ ] 数据库备份策略（每日 mysqldump）

### 扩容建议

- 后端无状态，多实例部署（Nginx upstream 负载均衡）
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

# 当前覆盖率（关键服务）
# - LoginThrottlerService: 100%
# - SessionService:        100%
# - GlobalExceptionFilter: 95%+
# - UserService:           70%+（核心路径）
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