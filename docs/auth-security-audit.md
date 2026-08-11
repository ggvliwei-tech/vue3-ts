# 登录鉴权体系安全审计报告

> 审计日期: 2026-08-11  
> 项目: vue3-monorepo (NestJS 11 + Vue 3)  
> 架构: pnpm monorepo (server / app / admin / shared)

## 变更记录

| 日期 | 变更内容 | 状态 |
|------|----------|------|
| 2026-08-11 | Refresh Token 从 MySQL 迁移至 Redis | ✅ 已实施 |
| 2026-08-11 | 初始安全审计 | ✅ 已完成 |

---

## 一、鉴权架构概览

### 1.1 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 后端 | NestJS 11 + JWT + bcrypt | 认证服务 + Token 签发 |
| 前端 | Vue 3 + Axios + localStorage | 用户登录 + Token 存储 |
| 共享 | Axios 拦截器 | Token 自动附加 + 401 自动刷新 + 请求队列 |
| 数据库 | PostgreSQL (TypeORM) | 用户数据 + Refresh Token 持久化 |

### 1.2 完整鉴权流程

```
注册 → POST /api/v1/user/register
  ↓  bcrypt hash (saltRounds=10) + DB unique constraint
  ↓  注册成功后跳转登录

登录 → POST /api/v1/user/login
  ↓  bcrypt.compare() 验证密码
  ↓  检查 account status (0=禁用)
  ↓  签发双 Token:
  ├── Access Token:  JWT(JWT_ACCESS_SECRET), 有效期 1min, 返回 JSON body
  └── Refresh Token: JWT(JWT_REFRESH_SECRET), 有效期 7d, HttpOnly Cookie

访问受保护接口 → 请求头携带 Authorization: Bearer <access_token>
  ↓  JwtAuthGuard 验证 Access Token
  ↓  request.user = { sub, username }

Access Token 过期 (401) → 共享拦截器自动发起刷新
  ↓  POST /api/v1/user/refresh-token (HttpOnly Cookie 自动携带)
  ↓  RefreshTokenGuard: 验证签名 + 比对 Redis 值 (内存操作, TTL 自动过期)
  ↓  签发新 Access Token + 轮换 Refresh Token (cookie + Redis 双更新)
  ↓  排队中的 401 请求用新 Token 重试

登出 → POST /api/v1/user/logout (需有效 JWT)
  ↓  Redis 删除 refresh:token:{userId} (服务端吊销)
  ↓  清除 refresh_token Cookie
```

### 1.3 API 端点清单

| Method | 路径 | 守卫 | 说明 |
|--------|------|------|------|
| POST | `/api/v1/user/register` | 无 | 用户注册 |
| POST | `/api/v1/user/login` | 无 | 用户登录 |
| POST | `/api/v1/user/refresh-token` | RefreshTokenGuard | 刷新 Access Token |
| POST | `/api/v1/user/logout` | JwtAuthGuard | 登出 |
| GET | `/api/v1/user` | JwtAuthGuard | 获取用户列表 |
| WebSocket | `chat.gateway` | JWT on connect | 即时通讯鉴权 |

---

## 二、现有安全机制（✅ 已落实）

| # | 机制 | 说明 | 评级 |
|---|------|------|------|
| 1 | **双 Token 体系** | 短期 Access Token (1m) + 长期 Refresh Token (7d)，攻击窗口极小 | ✅ 优秀 |
| 2 | **HttpOnly Cookie 存储 Refresh Token** | JavaScript 无法读取，有效防御 XSS 窃取 | ✅ 优秀 |
| 3 | **Redis 存储 Refresh Token** | Redis 内存操作（亚毫秒级），TTL 自动过期，职责分离（非业务数据不进 DB） | ✅ 优秀 |
| 4 | **Token 轮换 (Rotation)** | 每次刷新签发新 Refresh Token，旧 Token 失效 | ✅ 优秀 |
| 5 | **bcrypt 密码哈希** | saltRounds=10，计算成本合理 | ✅ 合格 |
| 6 | **模糊错误信息** | 统一返回"账号或密码错误"，防止用户枚举 | ✅ 优秀 |
| 7 | **账号状态检查** | status=0 时拒绝登录 | ✅ 合格 |
| 8 | **CORS 白名单 + credentials** | 限定 origin，支持 Cookie 跨域 | ✅ 合格 |
| 9 | **SameSite Cookie = lax** | 防御跨站请求伪造 | ✅ 合格 |
| 10 | **ValidationPipe** | `whitelist: true` + `forbidNonWhitelisted: true`，防字段注入 | ✅ 合格 |
| 11 | **DB 唯一约束** | 数据库层面防止重复用户名 | ✅ 合格 |
| 12 | **WebSocket JWT 鉴权** | Socket 连接时验证 JWT | ✅ 合格 |
| 13 | **401 自动刷新 + 请求队列** | 并发请求不会触发多次刷新，避免竞态条件 | ✅ 优秀 |

---

## 三、安全风险分析

### 🔴 高风险

| # | 风险 | 详细说明 | 影响 |
|---|------|----------|------|
| R1 | **缺少 `.env.example` 模板** | `packages/server/.env` 已列入 `.gitignore` 不会被提交，但项目缺少 `.env.example` 模板文件，新开发者不知道需要配置哪些环境变量，可能使用默认弱密钥 | 新环境可能使用弱密钥导致 JWT 可被破解 |
| R2 | **`.env` 中密钥强度不足** | `JWT_ACCESS_SECRET=AccessSecret2026@nest` 强度偏低，`DB_PWD=liwei` 为简单密码，即使未提交到 Git，本地泄露风险仍存在 | JWT 签名可被暴力破解；数据库可被入侵 |
| R3 | **登录/注册接口无限流** | 仅 AI 模块有 ThrottlerGuard (5req/10s)，登录和注册接口完全没有速率限制 | 攻击者可暴力破解密码或批量注册垃圾账号 |

### 🟡 中风险

| # | 风险 | 详细说明 | 影响 |
|---|------|----------|------|
| R4 | **Access Token 存储在 localStorage** | 虽然 Refresh Token 通过 HttpOnly Cookie 保护，但 Access Token 存储在 `localStorage`，XSS 攻击可读取 | XSS 攻击可窃取 Access Token (1min 内有效)，在有效期内可发起任意请求 |
| R5 | **无密码复杂度要求** | `CreateUserDto` 仅校验 `IsNotEmpty()`，无最小长度、无复杂度规则 | 用户可设置 `123`、`abc` 等弱密码 |
| R6 | **无 RBAC (基于角色的访问控制)** | 所有认证用户权限相同，无角色或权限区分 | 无法实现细粒度权限控制，普通用户可访问管理员接口 |
| R7 | **Admin 面板无鉴权实现** | `admin` 包存在但未实现登录/鉴权逻辑 | 管理后台一旦上线将完全暴露 |

### 🟢 低风险

| # | 风险 | 详细说明 | 影响 |
|---|------|----------|------|
| R8 | **Access Token 有效期极短 (1min)** | 每次用户操作超过 60 秒即触发刷新，刷新链路异常时用户体验差 | 可用性风险非安全风险，但可能诱导前端降低安全配置 |
| R9 | **无额外 CSRF 防护 Token** | 仅依赖 SameSite Cookie 防御 CSRF，缺乏双重提交 Token 等纵深防御 | SameSite 在老旧浏览器中不支持 |
| R10 | **数据库 seed 使用弱密码** | 种子管理员密码注释显示为 `123456`，初始密码过弱 | 初始环境可被轻易登录 |
| R11 | **无密码修改后的 Token 吊销** | 无密码修改端点（当前无此功能），但未来实现时需注意刷新 Token 的吊销 | 密码修改后旧 Refresh Token 仍有效 |

---

## 四、关键代码位置索引

### 后端

| 文件 | 职责 |
|------|------|
| [packages/server/src/modules/user/user.controller.ts](packages/server/src/modules/user/user.controller.ts) | 登录/注册/刷新/登出 接口 |
| [packages/server/src/modules/user/user.service.ts](packages/server/src/modules/user/user.service.ts) | 认证业务逻辑: 密码哈希、JWT 签发、Token 刷新 |
| [packages/server/src/common/guards/jwt-auth.guard.ts](packages/server/src/common/guards/jwt-auth.guard.ts) | JWT Access Token 守卫 |
| [packages/server/src/common/guards/refresh-token.guard.ts](packages/server/src/common/guards/refresh-token.guard.ts) | Refresh Token 守卫 |
| [packages/server/src/common/decorators/current-user.decorator.ts](packages/server/src/common/decorators/current-user.decorator.ts) | @CurrentUser() 参数装饰器 |
| [packages/server/src/common/filters/http-exception.filter.ts](packages/server/src/common/filters/http-exception.filter.ts) | 全局异常过滤器 |
| [packages/server/src/app.module.ts](packages/server/src/app.module.ts) | JwtModule + ConfigModule 配置 |
| [packages/server/src/main.ts](packages/server/src/main.ts) | CORS、cookie-parser 中间件 |
| [packages/server/src/config/configuration.ts](packages/server/src/config/configuration.ts) | 环境变量配置 |
| [packages/server/src/modules/chat/chat.gateway.ts](packages/server/src/modules/chat/chat.gateway.ts) | WebSocket JWT 鉴权 |

### 前端

| 文件 | 职责 |
|------|------|
| [packages/app/src/views/auth/Login.vue](packages/app/src/views/auth/Login.vue) | 登录页面 |
| [packages/app/src/views/auth/Register.vue](packages/app/src/views/auth/Register.vue) | 注册页面 |
| [packages/app/src/api/user.ts](packages/app/src/api/user.ts) | 认证 API 调用 |
| [packages/app/src/router/index.ts](packages/app/src/router/index.ts) | 路由守卫 |
| [packages/app/src/main.ts](packages/app/src/main.ts) | Token 刷新 + 未授权回调 |
| [packages/shared/src/request.ts](packages/shared/src/request.ts) | Axios 拦截器: Token 注入 + 401 自动刷新 + 请求队列 |

---

## 五、改进建议

### 优先级: P0 (立即处理)

| 建议 | 操作 |
|------|------|
| **创建 `.env.example`** | 在 `packages/server/` 下创建模板文件，标注所有必需环境变量 |
| **增强密钥强度** | `JWT_ACCESS_SECRET` 和 `JWT_REFRESH_SECRET` 使用 ≥32 字符的随机字符串（可用 `openssl rand -hex 32` 生成） |
| **登录/注册接口限流** | 添加 `@Throttle()` 装饰器到 `/login` 和 `/register` 端点（如 10 次/分钟） |

### 优先级: P1 (近期处理)

| 建议 | 操作 |
|------|------|
| **Access Token 安全存储** | 考虑将 Access Token 也改用 HttpOnly Cookie 存储（需处理 SameSite 和跨域问题） |
| **密码复杂度校验** | 在 `CreateUserDto` 中添加最小长度（≥8）、大小写+数字要求 |
| **实现 RBAC** | 引入用户角色（admin/user）和权限守卫 |
| **Admin 面板鉴权** | 为 `admin` 包实现完整的登录/鉴权流程 |

### 优先级: P2 (后续优化)

| 建议 | 操作 |
|------|------|
| **CSRF Token** | 添加双重提交 CSRF Token 作为纵深防御 |
| **密码修改 + Token 吊销** | 实现密码修改功能，修改后吊销所有 Refresh Token |
| **登录安全头** | 添加 `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` 等安全头 |
| **审计日志** | 记录登录成功/失败、Token 刷新、登出等安全事件 |

---

## 六、总体评价

| 维度 | 评级 | 说明 |
|------|------|------|
| 架构设计 | ⭐⭐⭐⭐ | 双 Token + HttpOnly Cookie + 服务端吊销 + Token 轮换，架构优秀 |
| 实现质量 | ⭐⭐⭐⭐ | 代码结构清晰，拦截器处理了 401 自动刷新和请求队列，细节到位 |
| 密钥管理 | ⭐⭐ | 缺少 `.env.example`，密钥强度不足，本地环境存在泄露风险 |
| 访问控制 | ⭐⭐ | 无 RBAC，所有认证用户权限一致，Admin 面板无鉴权 |
| 防护措施 | ⭐⭐⭐ | 有 bcrypt、模糊错误、CORS、SameSite，但缺少限流和密码复杂度 |

**结论**: 鉴权架构设计本身是**优秀**的，采用了业界最佳实践（双 Token、HttpOnly、服务端吊销、Token 轮换）。主要风险集中在**密钥管理**和**防护覆盖**两个方面，属于可快速修复的配置/补充问题，不影响核心架构的正确性。
